import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Sin caché incremental a propósito. El CRM es todo dinámico —cada página se
// arma en el servidor con datos de la base— así que no hay nada que guardar en
// caché entre visitas. La alternativa de la documentación usa un bucket de R2,
// que sería un servicio más que administrar para no guardar nada.
export default defineCloudflareConfig({});
