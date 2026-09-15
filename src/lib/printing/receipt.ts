import { COLUMNAS_80MM, EscPos } from "./escpos";
import { formatCurrency } from "../utils";
import { formatQuantity, round2, toNumber, type Numeric } from "../decimal";
import { outstanding } from "../sales";
import { paymentMethodLabels, type PaymentMethod } from "../payments";
import { differenceLabel } from "../cash";

// Comprobantes que se imprimen en el mostrador.
//
// Importante: esto NO es la boleta electrónica. La boleta es el documento
// tributario que emite el proveedor y que llega como PDF con su timbre; esto
// es el comprobante interno que se le pasa al cliente y que queda en el
// cajón. Cuando el proveedor devuelva el TED se puede imprimir su PDF417
// acá mismo pasándolo en `timbre`, y recién entonces el papel sirve como
// boleta.
//
// Los tipos son planos a propósito: reciben lo que Prisma devuelve ya
// serializado, sin arrastrar el cliente ni el esquema hasta la impresora.

export type LineaTicket = {
  nombre: string;
  cantidad: Numeric;
  unidad?: string | null;
  precioUnitario: Numeric;
  subtotal: Numeric;
};

export type PagoTicket = {
  metodo: PaymentMethod;
  monto: Numeric;
};

export type DatosTicket = {
  negocio: string;
  numero: number;
  fecha: Date | string;
  cajero: string | null;
  cliente: { nombre: string; deudaTotal?: Numeric } | null;
  lineas: LineaTicket[];
  total: Numeric;
  pagado: Numeric;
  pagos: PagoTicket[];
  /** Timbre electrónico del SII, si el proveedor lo devolvió. */
  timbre?: string | null;
  folio?: number | null;
  /** Certificación deja el aviso impreso: no es un documento válido. */
  ambienteCertificacion?: boolean;
  pie?: string | null;
};

function fechaChile(fecha: Date | string): string {
  const d = typeof fecha === "string" ? new Date(fecha) : fecha;
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Santiago",
  }).format(d);
}

export function ticketVenta(datos: DatosTicket, columnas = COLUMNAS_80MM): Uint8Array {
  const p = new EscPos(columnas);
  const saldo = outstanding(datos.total, datos.pagado);

  p.init();

  p.align("CENTRO").size(1, 2).bold(true).line(datos.negocio).bold(false).size(1, 1);

  if (datos.ambienteCertificacion) {
    // Va arriba y en grande porque el punto es que nadie lo confunda con una
    // boleta de verdad, ni el cajero ni el cliente.
    p.bold(true).line("DOCUMENTO DE PRUEBA").line("SIN VALIDEZ TRIBUTARIA").bold(false);
  }

  p.line(datos.folio ? `Boleta electronica N ${datos.folio}` : `Comprobante interno`);
  p.line(`Venta #${datos.numero}  ${fechaChile(datos.fecha)}`);
  if (datos.cajero) p.line(`Atendio: ${datos.cajero}`);
  p.separator("=");

  p.align("IZQUIERDA");
  for (const linea of datos.lineas) {
    p.line(linea.nombre);
    const detalle = `${formatQuantity(linea.cantidad, linea.unidad)} x ${formatCurrency(
      Number(linea.precioUnitario)
    )}`;
    p.row(`  ${detalle}`, formatCurrency(Number(linea.subtotal)));
  }

  p.separator();
  p.size(1, 2).bold(true);
  p.row("TOTAL", formatCurrency(Number(datos.total)));
  p.bold(false).size(1, 1);

  if (datos.pagos.length > 0) {
    p.line();
    for (const pago of datos.pagos) {
      p.row(paymentMethodLabels[pago.metodo] ?? pago.metodo, formatCurrency(Number(pago.monto)));
    }
  }

  if (saldo > 0) {
    // El fiado se imprime siempre, con el saldo de la venta y, si se conoce,
    // la deuda total del cliente: es la libreta, y el papel es la copia que
    // se lleva la persona.
    p.separator();
    p.bold(true).row("QUEDA DEBIENDO", formatCurrency(saldo)).bold(false);
    if (datos.cliente) {
      p.line(`Cliente: ${datos.cliente.nombre}`);
      if (datos.cliente.deudaTotal !== undefined) {
        p.row("Deuda total", formatCurrency(round2(datos.cliente.deudaTotal)));
      }
    }
  } else if (datos.cliente) {
    p.line(`Cliente: ${datos.cliente.nombre}`);
  }

  if (datos.timbre) {
    p.feed(1).align("CENTRO").pdf417(datos.timbre);
    p.line("Timbre electronico SII");
    p.line("Verifique en www.sii.cl");
  }

  p.align("CENTRO").feed(1);
  if (datos.pie) p.line(datos.pie);
  p.line("Gracias por su compra");

  return p.feed(2).cut().bytes();
}

export type DatosCierre = {
  negocio: string;
  turno: number;
  abiertoPor: string | null;
  cerradoPor: string | null;
  abiertoEn: Date | string;
  cerradoEn: Date | string;
  fondo: Numeric;
  porMedio: Record<string, number>;
  ventas: number;
  esperado: Numeric;
  contado: Numeric;
  diferencia: Numeric;
  nota?: string | null;
  /** Un corte X es una lectura del turno abierto; no cierra nada. */
  esLectura?: boolean;
};

/**
 * El comprobante del arqueo.
 *
 * Se imprime dos veces en la práctica: una queda en el cajón con la plata y
 * otra se la lleva quien cierra. Por eso el papel repite lo esperado y lo
 * contado en vez de solo la diferencia: si mañana no cuadra, el papel tiene
 * que poder reconstruir la cuenta sin abrir el sistema.
 */
export function ticketCierreTurno(datos: DatosCierre, columnas = COLUMNAS_80MM): Uint8Array {
  const p = new EscPos(columnas);
  const diferencia = round2(datos.diferencia);

  p.init().align("CENTRO");
  p.size(1, 2).bold(true).line(datos.negocio).bold(false).size(1, 1);
  p.bold(true).line(datos.esLectura ? "CORTE X (LECTURA)" : "CIERRE DE CAJA").bold(false);
  p.line(`Turno #${datos.turno}`);
  p.separator("=");

  p.align("IZQUIERDA");
  p.row("Abierto", fechaChile(datos.abiertoEn));
  if (datos.abiertoPor) p.row("Por", datos.abiertoPor);
  if (!datos.esLectura) {
    p.row("Cerrado", fechaChile(datos.cerradoEn));
    if (datos.cerradoPor) p.row("Por", datos.cerradoPor);
  }
  p.separator();

  p.row("Fondo inicial", formatCurrency(Number(datos.fondo)));
  p.row("Ventas del turno", String(datos.ventas));
  p.line();

  for (const [medio, monto] of Object.entries(datos.porMedio)) {
    p.row(paymentMethodLabels[medio as PaymentMethod] ?? medio, formatCurrency(monto));
  }

  p.separator();
  p.bold(true);
  p.row("EFECTIVO ESPERADO", formatCurrency(Number(datos.esperado)));
  p.row("EFECTIVO CONTADO", formatCurrency(Number(datos.contado)));
  p.bold(false);

  p.separator();
  p.size(1, 2).bold(true);
  p.row(
    differenceLabel(diferencia).toUpperCase(),
    diferencia === 0 ? formatCurrency(0) : formatCurrency(Math.abs(toNumber(diferencia)))
  );
  p.bold(false).size(1, 1);

  if (datos.nota) {
    p.line();
    p.line("Nota:");
    p.line(datos.nota);
  }

  p.feed(2);
  p.line("Firma: ______________________");

  return p.feed(2).cut().bytes();
}
