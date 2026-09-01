import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { productImportRowSchema } from "@/lib/validation";
import { parseProductImportFile, ProductImportParseError } from "@/lib/product-import";

export const maxDuration = 60;

export interface ProductImportPreviewRow {
  rowNumber: number;
  sku: string;
  name: string;
  qty: unknown;
  warehouseName: string;
  price: unknown;
  action: "crear" | "actualizar";
  isNewWarehouse: boolean;
  errors: string[];
}

// Solo lee el archivo y lo cruza contra lo que ya existe en la base de datos
// (SKUs y bodegas) — no escribe nada. El usuario confirma en /commit.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(session.user.role, "manageProducts")) {
    return NextResponse.json(
      { error: "No tienes permiso para importar productos" },
      { status: 403 }
    );
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No se recibió ningún archivo" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let rawRows;
  try {
    rawRows = await parseProductImportFile(buffer);
  } catch (err) {
    if (err instanceof ProductImportParseError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo leer el archivo" }, { status: 400 });
  }

  const [existingVariants, existingWarehouses] = await Promise.all([
    prisma.productVariant.findMany({ select: { sku: true } }),
    prisma.warehouse.findMany({ select: { name: true } }),
  ]);
  const existingSkus = new Set(existingVariants.map((v) => v.sku.toLowerCase()));
  const existingWarehouseNames = new Set(existingWarehouses.map((w) => w.name.toLowerCase()));
  // Clave sku+bodega, no solo sku: el mismo SKU puede aparecer en dos filas
  // legítimamente si trae stock en dos bodegas distintas. Solo es un
  // duplicado real si se repite la MISMA combinación sku+bodega.
  const seenKeysInFile = new Map<string, number>();

  const rows: ProductImportPreviewRow[] = rawRows.map((raw) => {
    const parsed = productImportRowSchema.safeParse(raw);

    if (!parsed.success) {
      return {
        rowNumber: raw.rowNumber,
        sku: raw.sku == null ? "" : String(raw.sku),
        name: raw.name == null ? "" : String(raw.name),
        qty: raw.qty,
        warehouseName: raw.warehouseName == null ? "" : String(raw.warehouseName),
        price: raw.price,
        action: "crear",
        isNewWarehouse: false,
        errors: parsed.error.issues.map((issue) => issue.message),
      };
    }

    const data = parsed.data;
    const skuLower = data.sku.toLowerCase();
    const dedupeKey = `${skuLower}|${data.warehouseName.toLowerCase()}`;
    const errors: string[] = [];
    if (seenKeysInFile.has(dedupeKey)) {
      errors.push(
        `Este SKU ya aparece en esta misma bodega en la fila ${seenKeysInFile.get(dedupeKey)}`
      );
    } else {
      seenKeysInFile.set(dedupeKey, data.rowNumber);
    }

    return {
      rowNumber: data.rowNumber,
      sku: data.sku,
      name: data.name,
      qty: data.qty,
      warehouseName: data.warehouseName,
      price: data.price,
      action: existingSkus.has(skuLower) ? "actualizar" : "crear",
      isNewWarehouse: !existingWarehouseNames.has(data.warehouseName.toLowerCase()),
      errors,
    };
  });

  const validRows = rows.filter((r) => r.errors.length === 0);
  const newWarehouses = Array.from(
    new Set(validRows.filter((r) => r.isNewWarehouse).map((r) => r.warehouseName))
  );

  const summary = {
    totalRows: rows.length,
    valid: validRows.length,
    invalid: rows.length - validRows.length,
    toCreate: validRows.filter((r) => r.action === "crear").length,
    toUpdate: validRows.filter((r) => r.action === "actualizar").length,
    newWarehouses,
  };

  return NextResponse.json({ rows, summary });
}
