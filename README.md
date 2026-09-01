# Cosme CRM — Fase 01: Fundaciones

CRM de control de inventario para e-commerce multicanal. Esta primera fase
entrega: autenticación con roles, catálogo de productos con variantes/SKU,
e inventario básico (entradas, salidas y ajustes de stock con historial
completo).

## Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS
- PostgreSQL + Prisma ORM
- NextAuth.js (credenciales + JWT) con control de acceso por rol

## Requisitos

- Node.js 20 o superior
- PostgreSQL 14+ (local o administrado, ej. Neon / Supabase)

## Puesta en marcha local

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Edita .env con tu cadena de conexión a PostgreSQL y genera un secreto:
# openssl rand -base64 32

# 3. Aplicar el esquema a la base de datos
npx prisma migrate dev

# 4. Cargar datos de ejemplo (usuarios de prueba + catálogo)
npm run db:seed

# 5. Levantar el servidor de desarrollo
npm run dev
```

Abre http://localhost:3000 — te va a redirigir a `/login`.

### Usuarios de prueba (creados por el seed)

| Rol       | Correo             | Contraseña   |
|-----------|---------------------|--------------|
| Admin     | admin@cosme.cl       | Admin123!    |
| Ventas    | ventas@cosme.cl      | Ventas123!   |
| Bodega    | bodega@cosme.cl      | Bodega123!   |
| Compras   | compras@cosme.cl     | Compras123!  |

Cámbialas (o elimina estos usuarios) antes de usar el sistema con datos reales.

## Qué incluye esta fase

- **Autenticación y roles** — login con correo/contraseña, sesión JWT,
  4 roles (Admin, Ventas, Bodega, Compras). Las reglas de permisos viven en
  `src/lib/rbac.ts`: hoy solo Admin gestiona el catálogo y Admin/Bodega
  registran movimientos de stock — a medida que se sumen Ventas y Compras
  (fases 02-03) ese es el único archivo que hay que ampliar.
- **Catálogo de productos** — productos con una o más variantes/SKU, precio,
  costo y umbral de stock bajo por variante.
- **Inventario** — registro de entradas, salidas y ajustes por bodega, con
  historial completo (nunca se edita ni se borra: cada movimiento queda
  registrado). El stock actual siempre es la suma de sus movimientos.
- **Multi-bodega preparado, no activado** — el esquema de datos ya modela
  `Warehouse` como una entidad propia. La Fase 01 opera con una sola bodega
  por defecto; activar varias más adelante es agregar registros y UI, no
  rediseñar la base de datos.
- **Panel** — resumen de productos, unidades en stock, alertas de stock bajo
  y actividad reciente.

## Estructura del proyecto

```
prisma/
  schema.prisma       Modelo de datos
  migrations/          Migraciones SQL
  seed.ts              Datos de ejemplo
src/
  app/
    login/              Página de inicio de sesión
    (app)/              Rutas protegidas (panel, productos, inventario)
    api/                Endpoints REST
  components/           Componentes de React (formularios, tablas, UI base)
  lib/
    auth.ts             Configuración de NextAuth
    rbac.ts             Reglas de permisos por rol
    prisma.ts           Cliente de Prisma
    validation.ts       Esquemas de validación (zod)
```

## Desplegar a producción

Pensado para desplegarse sin infraestructura propia:

1. **Base de datos**: crea un proyecto en [Neon](https://neon.tech) o
   [Supabase](https://supabase.com) (plan gratuito para partir) y copia su
   cadena de conexión a `DATABASE_URL`.
2. **Aplicación**: conecta el repositorio en [Vercel](https://vercel.com),
   define las variables de entorno (`DATABASE_URL`, `NEXTAUTH_SECRET`,
   `NEXTAUTH_URL` con tu dominio) y despliega.
3. Corre las migraciones contra la base de datos de producción:
   `npx prisma migrate deploy`.
4. Opcional: corre el seed una vez (`npm run db:seed`) para tener el primer
   usuario Admin, o crea uno manualmente con un script equivalente.

## Subir a GitHub

Este proyecto ya viene con un repositorio git inicializado y el primer
commit hecho. Para subirlo:

```bash
git remote add origin https://github.com/<tu-usuario>/cosme-crm.git
git branch -M main
git push -u origin main
```

## Próximos pasos (fases siguientes)

- **Fase 02** — Ventas y clientes (CRM): ficha de cliente, cotizaciones,
  órdenes de venta que descuenten stock automáticamente.
- **Fase 03** — Compras y proveedores: órdenes de compra, recepción de
  mercadería contra el inventario.
- **Fase 04** — Reportes y dashboards: rotación, valorización de stock,
  ventas por período.
- **Fase 05** — Integraciones externas: tienda propia y marketplaces.
- **Fase 06** — Activar multi-bodega en la interfaz.
