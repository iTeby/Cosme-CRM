import { withAuth } from "next-auth/middleware";

// Cualquier ruta bajo estos prefijos exige una sesión iniciada; sin sesión
// se redirige a /login (no a la página por defecto de NextAuth).
// El control fino por rol (quién puede crear/editar) se hace dentro de
// cada página y cada endpoint de la API, vía src/lib/rbac.ts.
//
// La lista tiene que cubrir todas las páginas de src/app/(app)/. Faltaban
// /quotes, /subscriptions, /cash y /production: no había agujero —el layout de
// (app) también exige sesión y redirige— pero el corte ocurría una capa más
// adentro. Al agregar una página nueva bajo (app), su prefijo va acá.
export default withAuth({
  pages: {
    signIn: "/login",
  },
});

export const config = {
  matcher: [
    "/whatsapp/:path*",
    "/dashboard/:path*",
    "/products/:path*",
    "/inventory/:path*",
    "/users/:path*",
    "/sales/:path*",
    "/customers/:path*",
    "/guion/:path*",
    "/quotes/:path*",
    "/subscriptions/:path*",
    "/cash/:path*",
    "/production/:path*",
    "/purchases/:path*",
    "/suppliers/:path*",
    "/reports/:path*",
  ],
};
