/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Sin esto, Next empaqueta Prisma dentro del bundle y OpenNext no alcanza a
  // parcharlo para el runtime de Cloudflare: el cliente termina buscando su
  // motor de consultas en Rust, que en un Worker no existe ni puede existir.
  // El síntoma es "could not locate the Query Engine for runtime
  // debian-openssl-1.1.x". Verificado el 18-09-2026 contra la documentación de
  // OpenNext (opennext.js.org/cloudflare/howtos/db).
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  images: {
    // El único next/image del proyecto es el logo. Optimizarlo no aporta nada y
    // obligaría a activar el binding de Cloudflare Images, que es un servicio
    // aparte con su propia cuota. Sin optimizar, el logo se sirve como archivo
    // estático desde los assets del Worker, que son gratis e ilimitados.
    unoptimized: true,
  },
};

export default nextConfig;
