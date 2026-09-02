"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { roleLabels } from "@/lib/rbac";
import { Logo } from "@/components/logo";
import type { UserRole } from "@prisma/client";

const links = [
  { href: "/dashboard", label: "Panel" },
  { href: "/products", label: "Productos" },
  { href: "/inventory", label: "Inventario" },
];

const salesLinks = [{ href: "/sales", label: "Ventas" }];
const customerLinks = [{ href: "/customers", label: "Clientes" }];
const purchaseLinks = [{ href: "/purchases", label: "Compras" }];
const supplierLinks = [{ href: "/suppliers", label: "Proveedores" }];
const reportLinks = [{ href: "/reports", label: "Reportes" }];
const adminLinks = [{ href: "/users", label: "Usuarios" }];

export function NavSidebar({
  userName,
  userRole,
}: {
  userName: string;
  userRole: UserRole;
}) {
  const pathname = usePathname();
  const canViewSales = userRole === "ADMIN" || userRole === "VENTAS" || userRole === "BODEGA";
  const canViewCustomers = userRole === "ADMIN" || userRole === "VENTAS";
  const canViewPurchases = userRole === "ADMIN" || userRole === "COMPRAS" || userRole === "BODEGA";
  const canViewSuppliers = userRole === "ADMIN" || userRole === "COMPRAS";
  const canViewReports =
    userRole === "ADMIN" || userRole === "VENTAS" || userRole === "BODEGA" || userRole === "COMPRAS";
  const visibleLinks = [
    ...links,
    ...(canViewSales ? salesLinks : []),
    ...(canViewCustomers ? customerLinks : []),
    ...(canViewPurchases ? purchaseLinks : []),
    ...(canViewSuppliers ? supplierLinks : []),
    ...(canViewReports ? reportLinks : []),
    ...(userRole === "ADMIN" ? adminLinks : []),
  ];

  return (
    // sticky top-0 + h-screen: el menú queda fijo en la pantalla mientras
    // se desplaza el contenido de la derecha, en vez de desaparecer hacia
    // arriba con el resto de la página (así se comporta en todas las
    // páginas, porque este componente es compartido por todo el layout).
    <aside className="sticky top-0 flex h-screen w-60 flex-shrink-0 flex-col border-r border-slate-200 bg-brand-900 text-white">
      <div className="flex-shrink-0 px-5 py-6">
        <Link href="/dashboard" className="inline-block">
          <Logo variant="light" className="h-7 w-auto" />
        </Link>
      </div>
      {/* min-h-0 es necesario para que overflow-y-auto funcione dentro de un
          contenedor flex en columna — si no, el nav empuja la altura del
          aside en vez de desplazarse internamente. */}
      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3">
        {visibleLinks.map((link) => {
          const active = pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-white/10 text-white"
                  : "text-brand-100/80 hover:bg-white/5 hover:text-white"
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex-shrink-0 border-t border-white/10 px-5 py-4">
        <p className="truncate text-sm font-medium text-white">{userName}</p>
        <p className="text-xs text-brand-200">{roleLabels[userRole]}</p>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="mt-3 text-xs font-medium text-brand-200 hover:text-white"
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
