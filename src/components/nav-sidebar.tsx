"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { can, roleLabels, type Permission } from "@/lib/rbac";
import { Logo } from "@/components/logo";
import type { UserRole } from "@prisma/client";

type NavLink = {
  href: string;
  label: string;
  // Permiso que habilita el enlace, tomado de src/lib/rbac.ts. `null` =
  // visible para cualquier sesión iniciada. Una lista significa "cualquiera
  // de estos": Reportes tiene dos secciones con permisos distintos y basta
  // con poder ver una para que el enlace tenga sentido.
  permission: Permission | Permission[] | null;
};

// Cada enlace declara su permiso en vez de comparar roles a mano. Son los
// mismos permisos que exigen las páginas en src/app/(app)/, así que el menú
// no puede ofrecer un enlace que después rebote al dashboard: si mañana
// cambia una regla en rbac.ts, el menú la hereda sin tocar este archivo.
// Cosme SpA vende servicios de software: no hay stock, mesón ni proveedores
// hoy. Las pestañas de almacén siguen existiendo por URL y su código está
// intacto; solo salen del menú. Para reactivar una, se mueve su línea de
// dormantLinks a navLinks.
const navLinks: NavLink[] = [
  { href: "/dashboard", label: "Panel", permission: null },
  { href: "/products", label: "Productos", permission: "viewCatalog" },
  { href: "/customers", label: "Clientes", permission: "manageCustomers" },
  { href: "/quotes", label: "Cotizaciones", permission: "viewQuotes" },
  { href: "/sales", label: "Ventas", permission: "viewSales" },
  { href: "/subscriptions", label: "Suscripciones", permission: "viewSubscriptions" },
  { href: "/reports", label: "Reportes", permission: ["viewSalesReports", "viewStockReports"] },
  { href: "/users", label: "Usuarios", permission: "manageUsers" },
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const dormantLinks: NavLink[] = [
  { href: "/inventory", label: "Inventario", permission: ["viewCatalog", "manageStock"] },
  { href: "/inventory/lotes", label: "Vencimientos", permission: ["viewCatalog", "manageStock"] },
  { href: "/production", label: "Producción", permission: "viewProduction" },
  { href: "/cash", label: "Caja", permission: "viewCashShift" },
  { href: "/purchases", label: "Compras", permission: "viewPurchases" },
  { href: "/suppliers", label: "Proveedores", permission: "manageSuppliers" },
];

export function NavSidebar({
  userName,
  userRole,
}: {
  userName: string;
  userRole: UserRole;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // El cajón se cierra solo al cambiar de página: si quedara abierto,
  // taparía el contenido recién cargado.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const visibleLinks = navLinks.filter((link) => {
    if (link.permission === null) return true;
    const requeridos = Array.isArray(link.permission) ? link.permission : [link.permission];
    return requeridos.some((permiso) => can(userRole, permiso));
  });

  const menu = (
    <>
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
    </>
  );

  return (
    <>
      {/* Escritorio: columna lateral fija. sticky top-0 + h-screen: el menú
          queda en pantalla mientras se desplaza el contenido de la derecha.
          min-h-0 en el nav es necesario para que overflow-y-auto funcione
          dentro de un flex en columna. */}
      <aside className="sticky top-0 hidden h-screen w-60 flex-shrink-0 flex-col border-r border-slate-200 bg-brand-900 text-white md:flex">
        <div className="flex-shrink-0 px-5 py-6">
          <Link href="/dashboard" className="inline-block">
            <Logo variant="light" className="h-7 w-auto" />
          </Link>
        </div>
        {menu}
      </aside>

      {/* Móvil: barra superior con el logo y el botón de menú. El menú se
          despliega como cajón sobre el contenido. */}
      <header className="sticky top-0 z-30 flex flex-shrink-0 items-center justify-between border-b border-white/10 bg-brand-900 px-4 py-3 text-white md:hidden">
        <Link href="/dashboard" className="inline-block">
          <Logo variant="light" className="h-6 w-auto" />
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="menu-movil"
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          className="rounded-md p-2 text-white hover:bg-white/10"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {open ? (
              <>
                <path d="M6 6l12 12" />
                <path d="M18 6L6 18" />
              </>
            ) : (
              <>
                <path d="M4 7h16" />
                <path d="M4 12h16" />
                <path d="M4 17h16" />
              </>
            )}
          </svg>
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-20 md:hidden">
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div
            id="menu-movil"
            className="absolute inset-y-0 left-0 flex w-64 max-w-[85vw] flex-col bg-brand-900 pt-16 text-white shadow-xl"
          >
            {menu}
          </div>
        </div>
      )}
    </>
  );
}
