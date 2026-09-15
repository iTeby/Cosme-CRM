import type { UserRole } from "@prisma/client";

// Reglas de permisos de la Fase 01. A medida que se sumen los módulos de
// Ventas y Compras (fases 02-03), este archivo es el único lugar que hay
// que tocar para ampliar lo que cada rol puede hacer.
const permissions = {
  manageProducts: ["ADMIN"],
  // CAJERO entra acá porque en un almacén quien atiende es quien recibe al
  // proveedor y quien anota la merma del pan al cerrar. No es lo mismo que
  // reescribir un movimiento ya registrado, que sigue siendo solo de Admin.
  manageStock: ["ADMIN", "BODEGA", "CAJERO"],
  // Editar/eliminar/duplicar un movimiento de inventario ya registrado es
  // más sensible que solo registrar uno nuevo (reescribe historial), así
  // que se restringe a Admin aunque Bodega pueda crear movimientos.
  editStockMovements: ["ADMIN"],
  manageUsers: ["ADMIN"],
  viewCatalog: ["ADMIN", "VENTAS", "CAJERO", "BODEGA", "COMPRAS"],
  // El costo de compra es el margen del negocio. Ver el catálogo para vender
  // no es lo mismo que saber cuánto se gana con cada producto, y hasta ahora
  // los cuatro roles lo veían: la ficha de producto lo pinta en una columna.
  // Es la misma fuga que motivó partir los reportes en dos.
  viewCost: ["ADMIN", "COMPRAS"],
  // El fiado se abre en el mostrador: quien atiende anota al cliente nuevo.
  manageCustomers: ["ADMIN", "VENTAS", "CAJERO"],
  manageSales: ["ADMIN", "VENTAS", "CAJERO"],
  // Registrar y deshacer abonos. Quien cobra en el mostrador es quien lo hace.
  managePayments: ["ADMIN", "VENTAS", "CAJERO"],
  // Ver el historial de caja —montos, medio de pago, quién debe— no es lo
  // mismo que ver ventas para preparar entregas. Bodega no entra.
  viewPayments: ["ADMIN", "VENTAS", "CAJERO"],
  viewSales: ["ADMIN", "VENTAS", "CAJERO", "BODEGA"],
  // Caja: abrir el turno, cobrar contra él y cerrarlo contando. Es el mismo
  // grupo que cobra, porque quien está en el mostrador es quien cuadra.
  manageCashShift: ["ADMIN", "VENTAS", "CAJERO"],
  viewCashShift: ["ADMIN", "VENTAS", "CAJERO"],
  manageSuppliers: ["ADMIN", "COMPRAS"],
  managePurchases: ["ADMIN", "COMPRAS"],
  viewPurchases: ["ADMIN", "COMPRAS", "BODEGA"],
  // D8 resuelto partiendo el permiso en dos, porque la página mezcla dos
  // cosas distintas: cuánto se vendió (plata, y no es de todos) y cómo está
  // el stock (operación, y sí le sirve a quien mueve mercadería). Antes un
  // solo `viewReports` abierto a los cuatro roles le mostraba la facturación
  // del negocio a quien solo necesitaba ver qué falta en bodega.
  // Emitir boleta es un acto tributario: queda a nombre del negocio ante el
  // SII y consume un folio que no vuelve. Lo hace quien atiende y la dueña.
  manageDte: ["ADMIN", "VENTAS", "CAJERO"],
  viewDte: ["ADMIN", "VENTAS", "CAJERO"],
  // CAJERO queda fuera a propósito, por el mismo motivo del corte: cobrar en
  // el mostrador no implica ver cuánto factura el almacén al mes. Si la
  // dueña quiere que alguien lo vea, le pone rol VENTAS.
  viewSalesReports: ["ADMIN", "VENTAS"],
  viewStockReports: ["ADMIN", "VENTAS", "CAJERO", "BODEGA", "COMPRAS"],
  // Producción: quien hornea no registra (los panaderos no tocan el sistema),
  // así que manageProduction es para quien cierra el día. Las recetas las
  // define solo Admin: cambiar una altera cuánto insumo descuenta cada
  // producción futura.
  viewProduction: ["ADMIN", "VENTAS", "CAJERO", "BODEGA"],
  manageProduction: ["ADMIN", "BODEGA", "CAJERO"],
  manageRecipes: ["ADMIN"],
} satisfies Record<string, UserRole[]>;

export type Permission = keyof typeof permissions;

export function can(role: UserRole | undefined, action: Permission): boolean {
  if (!role) return false;
  return (permissions[action] as UserRole[]).includes(role);
}

export const roleLabels: Record<UserRole, string> = {
  ADMIN: "Administrador",
  VENTAS: "Ventas",
  CAJERO: "Cajero",
  BODEGA: "Bodega",
  COMPRAS: "Compras",
};

/**
 * Qué hace cada rol, en una línea, para la pantalla de usuarios. Elegir un
 * rol por su nombre obliga a adivinar; esto lo dice.
 */
export const roleDescriptions: Record<UserRole, string> = {
  ADMIN: "Todo: catálogo, precios, recetas, usuarios y reportes.",
  VENTAS: "Vende, cobra, maneja clientes y caja. No toca el catálogo.",
  CAJERO: "Mostrador: vende, cobra, abre y cierra caja, recibe mercadería y registra la producción del día.",
  BODEGA: "Inventario y producción. No ve la caja ni las ventas en plata.",
  COMPRAS: "Proveedores y órdenes de compra.",
};
