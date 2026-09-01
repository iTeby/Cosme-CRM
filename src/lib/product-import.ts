import ExcelJS from "exceljs";

// Parser de la planilla de importación masiva de productos. En vez de exigir
// nombres de columna exactos, busca por palabras clave en el encabezado
// (sin tildes, sin mayúsculas) para tolerar variaciones razonables del
// archivo que suba el usuario, siempre que exista una columna reconocible
// de SKU, Nombre, Cantidad, Bodega y Valor/Precio.
export class ProductImportParseError extends Error {}

export interface RawImportRow {
  rowNumber: number;
  sku: unknown;
  name: unknown;
  qty: unknown;
  warehouseName: unknown;
  price: unknown;
}

type ColumnKey = "sku" | "name" | "qty" | "warehouseName" | "price";

const COLUMN_MATCHERS: { key: ColumnKey; label: string; test: (h: string) => boolean }[] = [
  { key: "sku", label: "SKU", test: (h) => h.includes("sku") },
  { key: "name", label: "Nombre", test: (h) => h.includes("nombre") || h.includes("producto") },
  {
    key: "qty",
    label: "Cantidad (qty)",
    test: (h) => h.includes("qty") || h.includes("cantidad") || h === "stock",
  },
  { key: "warehouseName", label: "Bodega", test: (h) => h.includes("bodega") },
  { key: "price", label: "Valor / Precio", test: (h) => h.includes("valor") || h.includes("precio") },
];

const DIACRITICS_REGEX = /[\u0300-\u036f]/g;

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS_REGEX, "");
}

function cellToString(value: ExcelJS.CellValue): unknown {
  if (value == null) return undefined;
  if (typeof value === "object") {
    if ("richText" in value) {
      return (value.richText as { text: string }[]).map((t) => t.text).join("");
    }
    if ("result" in value) {
      return (value as { result?: unknown }).result;
    }
    if ("text" in value) {
      return (value as { text?: unknown }).text;
    }
  }
  return value;
}

export async function parseProductImportFile(buffer: Buffer): Promise<RawImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new ProductImportParseError("El archivo no es un Excel válido (.xlsx).");
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new ProductImportParseError("El archivo no tiene ninguna hoja con datos.");
  }

  const columnIndex: Partial<Record<ColumnKey, number>> = {};
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const normalized = normalizeHeader(cellToString(cell.value));
    for (const matcher of COLUMN_MATCHERS) {
      if (!columnIndex[matcher.key] && matcher.test(normalized)) {
        columnIndex[matcher.key] = colNumber;
      }
    }
  });

  const missing = COLUMN_MATCHERS.filter((m) => !columnIndex[m.key]);
  if (missing.length > 0) {
    throw new ProductImportParseError(
      `No se encontraron estas columnas en el archivo: ${missing
        .map((m) => m.label)
        .join(", ")}. Usa un archivo con columnas de SKU, Nombre, Cantidad, Bodega y Valor.`
    );
  }

  const rows: RawImportRow[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const get = (key: ColumnKey) => cellToString(row.getCell(columnIndex[key]!).value);
    const sku = get("sku");
    const name = get("name");

    // Fila totalmente vacía (a veces queda una fila de más al final del
    // archivo): se ignora en vez de reportarla como error.
    if ((sku == null || sku === "") && (name == null || name === "")) return;

    rows.push({
      rowNumber,
      sku,
      name,
      qty: get("qty"),
      warehouseName: get("warehouseName"),
      price: get("price"),
    });
  });

  if (rows.length === 0) {
    throw new ProductImportParseError("El archivo no tiene filas de datos debajo del encabezado.");
  }

  return rows;
}
