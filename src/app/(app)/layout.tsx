import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { NavSidebar } from "@/components/nav-sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return (
    // En pantallas angostas el menú es una barra superior con botón y el
    // contenido va debajo; desde md vuelve a ser la columna lateral fija.
    // min-w-0 en main deja que las tablas anchas desplacen dentro de su
    // contenedor en vez de estirar la página.
    <div className="flex min-h-screen flex-col bg-brand-50 md:flex-row">
      <NavSidebar userName={session.user.name ?? session.user.email ?? ""} userRole={session.user.role} userEmail={session.user.email ?? ""} />
      <main className="min-w-0 flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
