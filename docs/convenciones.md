# Convenciones del proyecto

Notas técnicas de Cosme CRM: decisiones que no se ven leyendo el código y que
conviene tener presentes antes de tocarlo.

## Entornos

- Producción: Vercel, deploy automático al hacer push a `main`.
- Base de datos: PostgreSQL en Neon (branch `production`).
- `.env` nunca se commitea (está en `.gitignore`): contiene `DATABASE_URL` y
  `NEXTAUTH_SECRET`.

## Permisos

- Centralizados en `src/lib/rbac.ts` con `can(role, permission)`. Es el único
  lugar donde se define qué puede hacer cada rol.
- El menú lateral (`src/components/nav-sidebar.tsx`) declara un permiso por
  enlace y filtra con `can()`. No volver a comparar roles a mano ahí: el menú
  quedaría mintiendo apenas cambie una regla en `rbac.ts`.
- Cada página protegida vuelve a verificar el permiso del lado del servidor.
  Ocultar el enlace no es la protección.

## Inventario

- `StockMovement.quantity` es un delta con signo (positivo ENTRADA y AJUSTE+,
  negativo SALIDA y AJUSTE−); `StockLevel.quantity` es el stock acumulado, que se
  recalcula dentro de la misma transacción.
- Un `StockMovement` con `saleId` o `purchaseId` no nulo fue generado por Ventas
  o Compras: no se puede editar, eliminar ni duplicar directo (ver
  `src/app/api/stock-movements/[id]/route.ts`), para no desincronizar esos
  módulos.
- Una venta descuenta stock al crearse y lo devuelve al anularse. Una compra no
  toca el stock hasta que se marca RECIBIDA.

## Productos

- Bloquear un producto (`active: false`) desactiva en cascada sus variantes.
  Reactivarlo **no** las reactiva, para no pisar variantes que se desactivaron a
  mano.
- Eliminar un producto se apoya en las llaves foráneas de Postgres: si tiene
  ventas, compras o movimientos asociados, la base lo rechaza y el endpoint
  devuelve un 409 sugiriendo "Bloquear" en su lugar. No hay chequeo previo en la
  aplicación: la integridad la garantiza la base de datos.
- Las categorías son una lista curada en `src/lib/product-categories.ts`. Es el
  único lugar donde agregar o quitar una: se usa tanto en el desplegable del
  formulario como en la validación del backend.

## Interfaz

- Validación de inputs con `zod`, en `src/lib/validation.ts`.
- Sin librería de íconos externa: los pocos íconos son SVG inline (ver
  `src/components/ui/dropdown-menu.tsx`).
- El menú lateral usa `sticky top-0` sobre un contenedor `h-screen` para quedarse
  fijo mientras se desplaza el contenido.

## Usuarios

Los cuatro usuarios de `prisma/seed.ts` son datos de ejemplo para desarrollo
local: no existen en producción. El administrador de producción se crea con
`prisma/seed-prod.ts`, que toma correo y clave de variables de entorno y no pisa
un usuario que ya exista. De ahí en adelante los usuarios se gestionan desde
`/users` dentro de la app.

## Verificación antes de un push

No hay tests automatizados todavía. El mínimo es que estos dos pasen:

    npx tsc --noEmit
    npm run build

`npm run lint` no está configurado: el proyecto tiene `eslint` y
`eslint-config-next` instalados pero le falta el archivo de configuración, así
que `next lint` abre el asistente interactivo en vez de correr.
