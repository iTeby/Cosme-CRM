import { cache } from "react";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

// Un Worker de Cloudflare no puede abrir un socket TCP, que es como Prisma
// hablaba con Postgres hasta ahora. El adaptador de Neon resuelve eso: usa el
// driver serverless de Neon, que va por WebSocket sobre HTTPS.
//
// Es PrismaNeon y no PrismaNeonHttp a propósito. El modo HTTP es más simple y
// más rápido, pero NO soporta transacciones interactivas —las del tipo
// `prisma.$transaction(async (tx) => ...)`— y este CRM tiene 22. Una venta que
// descuenta stock y registra el movimiento tiene que ser todo o nada; con el
// modo HTTP quedaría a medias sin avisar. No se cambia sin revisar antes esas
// 22 transacciones.
//
// UN CLIENTE POR PETICIÓN, no uno global. En un servidor normal conviene
// reutilizar la conexión entre peticiones; en un Worker está prohibido. La
// conexión pertenece a la petición que la abrió y Cloudflare la cierra al
// terminarla, así que un cliente guardado en globalThis funciona las primeras
// veces y después falla de forma intermitente. `cache` de React lo resuelve:
// entrega el mismo cliente dentro de una petición y uno nuevo en la siguiente.
const obtenerCliente = cache(() => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "Falta DATABASE_URL. En Cloudflare se define con: npx wrangler secret put DATABASE_URL",
    );
  }

  return new PrismaClient({
    // max: cuántas conexiones puede tener abiertas a la vez ESTA petición.
    // Estuvo en 1 y fue un error caro: con una sola conexión, un
    // `Promise.all` de cuatro consultas se forma en fila igual y paga cuatro
    // viajes a la base uno tras otro. La página de reportes tardaba 2,6 s por
    // esto. Con 5 caben en paralelo las consultas de la página más pesada.
    //
    // maxUses: 1 se mantiene. Es la recomendación de OpenNext y evita que una
    // conexión sobreviva a la petición que la abrió, que es lo que falla de
    // forma intermitente en un Worker. Cuesta un saludo de red por consulta,
    // pero ahora esos saludos ocurren en paralelo y no en fila.
    adapter: new PrismaNeon({ connectionString, max: 5, maxUses: 1 }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
});

// Este intermediario existe para no tocar los 26 archivos que ya escriben
// `prisma.venta.create(...)`. Cada vez que se le pide algo, crea o recupera el
// cliente de ESTA petición y le pasa la llamada. Las funciones se enlazan al
// cliente para que `prisma.$transaction(...)` siga funcionando.
export const prisma = new Proxy({} as PrismaClient, {
  get(_destino, propiedad) {
    const cliente = obtenerCliente();
    const valor = Reflect.get(cliente, propiedad, cliente);
    return typeof valor === "function" ? valor.bind(cliente) : valor;
  },
});
