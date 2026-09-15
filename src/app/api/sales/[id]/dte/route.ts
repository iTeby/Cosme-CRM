import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import {
  DteAlreadyIssuedError,
  DteInFlightError,
  DteIndeterminateError,
  DteNotIssuableError,
  dteConfig,
  faltantesDeConfiguracion,
  prepararDte,
  proveedorVigente,
  registrarResultado,
  type DteTipo,
} from "@/lib/dte";

// Solo boleta por ahora. El motor soporta los tres, pero no hay pantalla que
// elija el tipo, y aceptarlos desde la API dejaba emitir una factura sobre una
// venta que ya tenía boleta con un POST a mano: dos documentos tributarios por
// una sola venta. Se abre cuando exista la pantalla.
const tiposValidos: DteTipo[] = ["BOLETA"];

// Emitir el documento tributario de una venta.
//
// Tres tiempos, y el del medio deliberadamente fuera de transacción: ver el
// comentario de cabecera de src/lib/dte/issue.ts.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageDte")) {
    return NextResponse.json(
      { error: "No tienes permiso para emitir documentos tributarios" },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const tipo = (body?.tipo as DteTipo) ?? "BOLETA";
  if (!tiposValidos.includes(tipo)) {
    return NextResponse.json({ error: "Tipo de documento no válido" }, { status: 400 });
  }
  const identificarReceptor = body?.identificarReceptor === true;

  const config = dteConfig();
  const faltan = faltantesDeConfiguracion(config);
  if (faltan.length > 0) {
    return NextResponse.json(
      {
        error: `Falta configurar los datos del emisor: ${faltan.join(", ")}. Sin eso el SII rechaza el documento.`,
      },
      { status: 409 }
    );
  }

  let preparado;
  try {
    preparado = await prisma.$transaction((tx) =>
      prepararDte(tx, {
        saleId: params.id,
        tipo,
        environment: config.environment,
        provider: config.provider,
        identificarReceptor,
      })
    );
  } catch (err: unknown) {
    if (err instanceof DteAlreadyIssuedError) {
      return NextResponse.json(
        {
          error: err.folio
            ? `Esta venta ya tiene un documento emitido, folio ${err.folio}.`
            : "Esta venta ya tiene un documento emitido.",
        },
        { status: 409 }
      );
    }
    if (err instanceof DteInFlightError) {
      return NextResponse.json(
        { error: "Ya hay una emisión en curso para esta venta. Espera y recarga." },
        { status: 409 }
      );
    }
    if (err instanceof DteIndeterminateError) {
      return NextResponse.json(
        {
          error:
            "El intento anterior quedó sin confirmar: puede que la boleta se haya emitido igual. Revísalo en el portal del proveedor antes de volver a emitir, porque un segundo intento gastaría otro folio.",
        },
        { status: 409 }
      );
    }
    // Carrera pura: dos peticiones creando la misma fila a la vez. La que
    // pierde revienta con el unique sin haber emitido nada.
    if ((err as { code?: string })?.code === "P2002") {
      return NextResponse.json(
        { error: "Ya hay una emisión en curso para esta venta. Espera y recarga." },
        { status: 409 }
      );
    }
    if (err instanceof DteNotIssuableError) {
      return NextResponse.json({ error: err.motivo }, { status: 409 });
    }
    if (err instanceof Error && err.message === "SALE_NOT_FOUND") {
      return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo preparar el documento" }, { status: 500 });
  }

  // Fuera de la transacción. Si esto falla o se cuelga, la fila ya existe en
  // PENDIENTE y el rastro no se pierde.
  const proveedor = proveedorVigente();
  const resultado = await proveedor.emit(preparado.emitInput);

  let dte;
  try {
    dte = await prisma.$transaction((tx) => registrarResultado(tx, preparado.dte.id, resultado));
  } catch (err: unknown) {
    // Acá el folio ya se gastó y lo único que queda de él es este log. Que
    // quede entero, con la respuesta cruda: es lo que va a permitir
    // reconstruir a mano lo que pasó.
    console.error(
      "DTE_RESULTADO_NO_GUARDADO",
      preparado.dte.id,
      JSON.stringify(resultado),
      err
    );
    return NextResponse.json(
      {
        error: `El documento se envió${
          resultado.folio ? ` (folio ${resultado.folio})` : ""
        } pero no se pudo guardar en la base. NO vuelvas a emitir: avisa primero, o se gastaría otro folio.`,
      },
      { status: 500 }
    );
  }

  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.error ?? "El proveedor rechazó el documento", dte },
      { status: 502 }
    );
  }

  return NextResponse.json(dte, { status: 201 });
}
