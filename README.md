# Cosme CRM

CRM interno de Cosme SpA: control de inventario para e-commerce multicanal, con
ventas, compras, clientes, proveedores y reportes.

En producción: https://cosme-crm-green.vercel.app

## Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS
- PostgreSQL + Prisma ORM
- NextAuth.js (credenciales + JWT) con control de acceso por rol
- recharts para los gráficos, exceljs para la importación, zod para validación

## Qué incluye hoy

- **Autenticación y roles** — login con correo/contraseña, sesión JWT y cuatro roles:
  Admin, Ventas, Bodega y Compras. Las reglas de permisos viven en un solo lugar,
  `src/lib/rbac.ts`, y tanto las páginas como el menú lateral las consultan desde ahí.
- **Catálogo de productos** — productos con una o más variantes/SKU, precio, costo,
  umbral de stock bajo y categoría tomada de una lista curada. Incluye buscador (por
  nombre, SKU o categoría) y acciones de bloquear, reactivar y eliminar.
- **Inventario** — entradas, salidas y ajustes por bodega, con historial completo. El
  stock actual es el acumulado de sus movimientos, recalculado dentro de la misma
  transacción. Los movimientos manuales se pueden editar, duplicar o eliminar (solo
  Admin); los generados por una venta o compra quedan bloqueados para no
  desincronizar esos módulos.
- **Ventas** — órdenes con estados PENDIENTE → PAGADA → ENTREGADA, o ANULADA.
  Descuentan stock al crearse y lo devuelven al anularse.
- **Clientes** — ficha con historial de compras.
- **Compras** — órdenes con estados PENDIENTE → RECIBIDA, o ANULADA. Suman stock al
  marcarse como recibidas.
- **Proveedores** — ficha con historial.
- **Reportes** — ventas por estado, ventas mensuales de los últimos seis meses, uso de
  bodega de los últimos 30 días, stock por categoría y top 10 de stock crítico.
- **Importación masiva** — carga de productos desde Excel, con vista previa antes de
  confirmar.
- **Multi-bodega preparado, no activado** — el esquema modela `Warehouse` como entidad
  propia y tanto `StockLevel` como `StockMovement` ya llevan `warehouseId`. Hoy opera
  con una sola bodega por defecto; activar varias es trabajo de interfaz y endpoints,
  no una migración de datos.

## Requisitos

- Node.js 20 o superior
- PostgreSQL 14+ (local o administrado, ej. Neon / Supabase)

## Puesta en marcha local

Instalar dependencias:

```bash
npm install
```

Configurar variables de entorno. Copia el ejemplo y edítalo con tu cadena de conexión
a PostgreSQL; para `NEXTAUTH_SECRET` sirve la salida de `openssl rand -base64 32`:

```bash
cp .env.example .env
```

Aplicar el esquema a la base de datos y cargar datos de ejemplo:

```bash
npx prisma migrate dev
npm run db:seed
```

Levantar el servidor de desarrollo:

```bash
npm run dev
```

Abre http://localhost:3000 — te va a redirigir a `/login`.

### Usuarios de ejemplo

`npm run db:seed` crea un usuario por rol (`admin@cosme.cl`, `ventas@cosme.cl`,
`bodega@cosme.cl`, `compras@cosme.cl`) junto con un catálogo de prueba. Las
contraseñas están en `prisma/seed.ts`.

**Son solo para desarrollo local.** No existen en producción y no deben usarse con
datos reales: `npm run db:seed` está pensado para una base desechable.

## Estructura del proyecto

```
prisma/
  schema.prisma        Modelo de datos
  migrations/          Migraciones SQL
  seed.ts              Usuarios y catálogo de ejemplo (desarrollo)
  seed-prod.ts         Bodega por defecto + primer usuario admin (producción)
src/
  app/
    login/             Página de inicio de sesión
    (app)/             Rutas protegidas: panel, productos, inventario, ventas,
                       clientes, compras, proveedores, reportes, usuarios
    api/               Endpoints REST. Aquí vive la lógica transaccional de
                       stock: ventas, compras y movimientos de inventario
  components/          Componentes de React (formularios, tablas, UI base)
  lib/
    auth.ts            Configuración de NextAuth
    rbac.ts            Reglas de permisos por rol
    prisma.ts          Cliente de Prisma
    validation.ts      Esquemas de validación (zod)
    sales.ts           Estados de venta: etiquetas y transiciones permitidas
    purchases.ts       Estados de compra: etiquetas y transiciones permitidas
    product-categories.ts  Lista curada de categorías
  middleware.ts        Protección de rutas
```

## Despliegue

El proyecto ya está desplegado: Vercel para la aplicación (deploy automático al hacer
push a `main`) y Neon para la base de datos.

Para levantar un entorno nuevo desde cero:

1. **Base de datos**: crea un proyecto en [Neon](https://neon.tech) o
   [Supabase](https://supabase.com) y copia su cadena de conexión a `DATABASE_URL`.
2. **Aplicación**: conecta el repositorio en [Vercel](https://vercel.com) y define
   `DATABASE_URL`, `NEXTAUTH_SECRET` y `NEXTAUTH_URL` con tu dominio.
3. Corre las migraciones contra la base de producción con
   `npx prisma migrate deploy`.
4. Crea el primer usuario administrador con `npm run db:seed:prod`, pasándole
   `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME` y `SEED_ADMIN_PASSWORD`. El script no
   modifica un usuario que ya exista, así que es seguro volver a correrlo. De ahí en
   adelante los usuarios se gestionan desde `/users` dentro de la app.

No corras `npm run db:seed` contra producción: ese carga usuarios y productos de
prueba.

## Verificación antes de un push

No hay tests automatizados todavía. La verificación mínima es:

```bash
npx tsc --noEmit
npm run build
```

## Próximos pasos

- **Cotizaciones** — Cosme cotiza antes de vender, y hoy ese paso ocurre fuera del
  sistema: se redigita como venta cuando el cliente acepta. Es el hueco más grande
  entre lo que el CRM modela y cómo opera el negocio.
- **Tests de la lógica de stock** — es la lógica que más duele si se rompe, porque
  desincroniza el inventario en silencio.
- **Monitoreo de errores en producción** — hoy un error en Vercel pasa inadvertido.
- **Activar multi-bodega en la interfaz** — cuando el negocio lo necesite.
- **Integraciones externas** — tienda propia y marketplaces.
