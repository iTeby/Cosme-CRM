import type { Prisma } from "@prisma/client";
import { round2, round3, toNumber, type Numeric } from "../decimal";
import { dteAmountsExempt, dteAmountsFromGross, normalizarRut, rutValido } from "./amounts";
import type { DteEmitInput, DteEmitResult, DteLinea, DteTipo } from "./provider";

// La puerta de escritura de documentos tributarios.
//
// El flujo tiene tres tiempos a propósito, y el del medio no es una
// transacción de base de datos:
//
//   1. prepararDte  — transacción: valida y deja la fila en PENDIENTE.
//   2. la llamada al proveedor — fuera de toda transacción.
//   3. registrarResultado — transacción: guarda folio o error.
//
// El paso 2 queda fuera porque una llamada HTTP dentro de una transacción
// mantiene locks abiertos durante toda la latencia de red, y si el proveedor
// se demora veinte segundos, la venta queda bloqueada veinte segundos. Y el
// paso 1 va antes del envío, no después, porque si el proceso se cae entre el
// envío y la respuesta tiene que quedar el rastro de que se intentó: sin esa
// fila, un corte en ese punto consumiría un folio real que el sistema no
// sabría que existe.

export type Tx = Prisma.TransactionClient;

/** Ya hay un documento emitido y aceptado para esta venta. */
export class DteAlreadyIssuedError extends Error {
  readonly folio?: number | null;
  constructor(folio?: number | null) {
    super("DTE_ALREADY_ISSUED");
    this.name = "DteAlreadyIssuedError";
    this.folio = folio;
  }
}

/** Hay una emisión en curso para esta venta. */
export class DteInFlightError extends Error {
  constructor() {
    super("DTE_IN_FLIGHT");
    this.name = "DteInFlightError";
  }
}

/**
 * El intento anterior quedó sin resolver: puede que el folio se haya
 * consumido. No se reintenta solo; hay que ir a mirar el portal primero.
 */
export class DteIndeterminateError extends Error {
  readonly dteId: string;
  constructor(dteId: string) {
    super("DTE_INDETERMINATE");
    this.name = "DteIndeterminateError";
    this.dteId = dteId;
  }
}

/** La venta no puede facturarse (anulada, sin líneas, etc.). */
export class DteNotIssuableError extends Error {
  // Campo explícito y no propiedad de parámetro: el runner de pruebas corre
  // con el modo strip-only de Node, que no las soporta.
  readonly motivo: string;
  constructor(motivo: string) {
    super("DTE_NOT_ISSUABLE");
    this.name = "DteNotIssuableError";
    this.motivo = motivo;
  }
}

/**
 * Cuánto se espera antes de considerar que una emisión PENDIENTE se cayó.
 *
 * Dos minutos: el proveedor corta a los veinte segundos, así que una fila que
 * lleva dos minutos en PENDIENTE es un proceso muerto, no una llamada lenta.
 * Reintentar antes sí podría emitir dos veces.
 */
const MINUTOS_EMISION_COLGADA = 2;

export function idempotencyKeyFor(
  tenantId: string,
  environment: string,
  tipo: DteTipo,
  saleId: string
): string {
  return `${tenantId}:${environment}:${tipo}:${saleId}`;
}

/**
 * Arma las líneas del documento y sus montos.
 *
 * El total del documento es la SUMA de las líneas ya redondeadas a peso, no
 * el total de la venta redondeado: el SII valida que MntTotal calce con el
 * detalle, y redondear cada cosa por su lado deja diferencias de un peso que
 * hacen rechazar el documento después de consumir el folio.
 */
export function lineasYMontos(
  items: { quantity: Numeric; unitPrice: Numeric; nombre: string }[],
  tipo: DteTipo,
  totalVenta: Numeric
) {
  const lineas: DteLinea[] = items.map((item) => {
    const cantidad = round3(item.quantity);
    // El MISMO precio en PrcItem y en el cálculo de MontoItem. Redondear el
    // precio a peso para mostrarlo y calcular el monto con el precio sin
    // redondear hacía que QtyItem x PrcItem no diera MontoItem: con
    // $1.990,50 x 10 unidades el documento declaraba 19.905 y el detalle
    // decía 19.910. El SII valida esa relación y rechaza el documento, ya
    // con el folio consumido. El SII sí acepta decimales en PrcItem; el que
    // tiene que ser entero es MontoItem.
    const precio = round2(item.unitPrice);
    return {
      nombre: item.nombre,
      cantidad,
      precioUnitario: precio,
      monto: Math.round(cantidad * precio),
    };
  });

  const totalLineas = lineas.reduce((acc, l) => acc + l.monto, 0);
  const montos =
    tipo === "BOLETA_EXENTA" ? dteAmountsExempt(totalLineas) : dteAmountsFromGross(totalLineas);

  return {
    lineas,
    ...montos,
    // Contra el total de la venta, que es el que el cliente pagó.
    roundingDelta: round2(montos.total - toNumber(totalVenta)),
  };
}

export type PrepararInput = {
  saleId: string;
  tipo: DteTipo;
  environment: string;
  provider: string;
  tenantId?: string;
  /** Identificar al comprador solo si lo pidió. */
  identificarReceptor?: boolean;
};

/**
 * Paso 1: valida y reserva la fila. No llama a nadie.
 *
 * Devuelve la fila y el input que hay que mandarle al proveedor.
 */
export async function prepararDte(tx: Tx, input: PrepararInput) {
  const tenantId = input.tenantId ?? "cosme";

  const venta = await tx.sale.findUnique({
    where: { id: input.saleId },
    include: {
      customer: true,
      items: { include: { variant: { include: { product: true } } } },
    },
  });
  if (!venta) throw new Error("SALE_NOT_FOUND");
  if (venta.status === "ANULADA") {
    throw new DteNotIssuableError("La venta está anulada");
  }
  if (venta.items.length === 0) {
    throw new DteNotIssuableError("La venta no tiene líneas");
  }

  const { lineas, net, tax, total, roundingDelta } = lineasYMontos(
    venta.items.map((item) => ({
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      nombre: item.variant.product.name,
    })),
    input.tipo,
    venta.totalAmount
  );

  if (total <= 0) throw new DteNotIssuableError("El total del documento es cero");

  // Un peso de diferencia es redondeo a peso entero y es normal. Más que eso
  // ya no es redondeo: es que el total de la venta y la suma de sus líneas no
  // coinciden, y entonces la boleta declararía un monto distinto al cobrado.
  // Mejor no emitirla que emitirla mal.
  if (Math.abs(roundingDelta) > 1) {
    throw new DteNotIssuableError(
      `El documento suma ${total} y la venta ${toNumber(venta.totalAmount)}. Revisa las líneas antes de emitir.`
    );
  }

  const receptorRut = normalizarRut(venta.customer.taxId);
  if (input.identificarReceptor) {
    if (!receptorRut) {
      throw new DteNotIssuableError("El cliente no tiene RUT registrado");
    }
    if (!rutValido(receptorRut)) {
      throw new DteNotIssuableError(`El RUT ${receptorRut} tiene el dígito verificador malo`);
    }
  }

  // Un documento vivo de CUALQUIER tipo bloquea: la clave de idempotencia
  // incluye el tipo, así que sin esto una venta con boleta aceptada podía
  // emitir además una factura y quedar con dos documentos tributarios.
  const vivo = await tx.dte.findFirst({
    where: {
      saleId: input.saleId,
      environment: input.environment as never,
      status: { in: ["ENVIADO", "ACEPTADO"] },
    },
  });
  if (vivo) throw new DteAlreadyIssuedError(vivo.folio);

  const key = idempotencyKeyFor(tenantId, input.environment, input.tipo, input.saleId);
  const datosComunes = {
    status: "PENDIENTE" as const,
    provider: input.provider,
    netAmount: net,
    taxAmount: tax,
    totalAmount: total,
    roundingDelta,
    errorMessage: null,
  };

  // Se lee primero y se crea después, en vez de crear y capturar el P2002.
  //
  // En Postgres, un statement que falla dentro de una transacción la deja
  // abortada: todo lo que venga después devuelve 25P02. Capturar el choque
  // del unique y seguir consultando con el mismo `tx` hacía que la rama de
  // reintento entera fuera código muerto —el 409 "ya tiene documento" nunca
  // se lanzaba y una fila en ERROR no se podía reintentar nunca, siempre 500.
  //
  // La carrera create/create la sigue cortando el unique: si dos peticiones
  // llegan a la vez, una revienta con P2002 y aborta su propia transacción
  // sin haber emitido nada. La ruta lo traduce a 409.
  const previo = await tx.dte.findUnique({ where: { idempotencyKey: key } });

  let dte;
  if (!previo) {
    dte = await tx.dte.create({
      data: {
        tenantId,
        saleId: input.saleId,
        type: input.tipo,
        environment: input.environment as never,
        idempotencyKey: key,
        ...datosComunes,
      },
    });
  } else {
    if (previo.status === "ACEPTADO" || previo.status === "ENVIADO") {
      throw new DteAlreadyIssuedError(previo.folio);
    }
    if (previo.status === "INDETERMINADO") throw new DteIndeterminateError(previo.id);

    // Se reclama con un updateMany condicionado, no con un update a secas:
    // dos clics seguidos leerían ambos el mismo estado y emitirían dos veces.
    // Una fila PENDIENTE reciente es una emisión en curso; una vieja es un
    // proceso que se cayó y sí se puede reintentar. INDETERMINADO queda
    // fuera del OR a propósito: ese solo se desbloquea a mano.
    const limite = new Date(Date.now() - MINUTOS_EMISION_COLGADA * 60_000);
    const reclamado = await tx.dte.updateMany({
      where: {
        id: previo.id,
        OR: [
          { status: { in: ["ERROR", "RECHAZADO"] } },
          { status: "PENDIENTE", updatedAt: { lt: limite } },
        ],
      },
      data: datosComunes,
    });

    if (reclamado.count === 0) throw new DteInFlightError();
    dte = await tx.dte.findUniqueOrThrow({ where: { id: previo.id } });
  }

  const emitInput: DteEmitInput = {
    tipo: input.tipo,
    referenciaInterna: dte.id,
    receptor: input.identificarReceptor
      ? { rut: receptorRut, razonSocial: venta.customer.name }
      : null,
    lineas,
    neto: net,
    iva: tax,
    total,
  };

  return { dte, emitInput, venta };
}

/** Paso 3: guarda lo que respondió el proveedor. */
export async function registrarResultado(tx: Tx, dteId: string, resultado: DteEmitResult) {
  if (!resultado.ok) {
    return tx.dte.update({
      where: { id: dteId },
      data: {
        // INDETERMINADO cuando no consta que el folio quedó sin consumir.
        // Ese estado no se reintenta solo: ver prepararDte.
        status: resultado.indeterminado ? "INDETERMINADO" : "ERROR",
        errorMessage: resultado.error ?? "Error desconocido",
        rawResponse: resultado.raw ?? null,
      },
    });
  }

  return tx.dte.update({
    where: { id: dteId },
    data: {
      // ENVIADO y no ACEPTADO: el proveedor lo recibió, el SII todavía no
      // dijo nada. Marcarlo como aceptado acá sería afirmar algo que nadie
      // afirmó. Pasa a ACEPTADO cuando se consulte el estado.
      status: "ENVIADO",
      folio: resultado.folio ?? null,
      externalId: resultado.externalId ?? null,
      trackId: resultado.trackId ?? null,
      pdfUrl: resultado.pdfUrl ?? null,
      rawResponse: resultado.raw ?? null,
      errorMessage: null,
      issuedAt: new Date(),
    },
  });
}

export const dteStatusLabels: Record<string, string> = {
  PENDIENTE: "Pendiente",
  ENVIADO: "Enviada",
  ACEPTADO: "Aceptada por el SII",
  RECHAZADO: "Rechazada por el SII",
  ERROR: "Error al emitir",
  INDETERMINADO: "Sin confirmar",
  ANULADO: "Anulada",
};

export const dteStatusTone: Record<string, "neutral" | "good" | "warn" | "critical"> = {
  PENDIENTE: "neutral",
  ENVIADO: "warn",
  ACEPTADO: "good",
  RECHAZADO: "critical",
  ERROR: "critical",
  INDETERMINADO: "warn",
  ANULADO: "neutral",
};

export const dteTypeLabels: Record<string, string> = {
  BOLETA: "Boleta electrónica",
  BOLETA_EXENTA: "Boleta exenta",
  FACTURA: "Factura electrónica",
};
