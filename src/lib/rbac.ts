import type { UserRole } from "@prisma/client";

// Reglas de permisos de la Fase 01. A medida que se sumen los módulos de
// Ventas y Compras (fases 02-03), este archivo es el único lugar que hay
// que tocar para ampliar lo que cada rol puede hacer.
const permissions = {
  manageProducts: ["ADMIN"],
  manageStock: ["ADMIN", "BODEGA"],
  viewCatalog: ["ADMIN", "VENTAS", "BODEGA", "COMPRAS"],
} satisfies Record<string, UserRole[]>;

export type Permission = keyof typeof permissions;

export function can(role: UserRole | undefined, action: Permission): boolean {
  if (!role) return false;
  return (permissions[action] as UserRole[]).includes(role);
}

export const roleLabels: Record<UserRole, string> = {
  ADMIN: "Administrador",
  VENTAS: "Ventas",
  BODEGA: "Bodega",
  COMPRAS: "Compras",
};
