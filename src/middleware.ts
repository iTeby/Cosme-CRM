import { withAuth } from "next-auth/middleware";

// Cualquier ruta bajo estos prefijos exige una sesión iniciada; sin sesión
// se redirige a /login (no a la página por defecto de NextAuth).
// El control fino por rol (quién puede crear/editar) se hace dentro de
// cada página y cada endpoint de la API, vía src/lib/rbac.ts.
export default withAuth({
  pages: {
    signIn: "/login",
  },
});

export const config = {
  matcher: ["/dashboard/:path*", "/products/:path*", "/inventory/:path*"],
};
