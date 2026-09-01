# Cosme CRM — notas de proyecto para Claude

## Qué es esto
CRM interno de Cosme (ventas, inventario, compras/proveedores, clientes, reportes).
Next.js 14 (App Router) + TypeScript + Prisma + PostgreSQL (Neon) + NextAuth v4 + Tailwind.

- Producción: https://cosme-crm-green.vercel.app (Vercel, deploy automático al hacer push a `main` en GitHub).
- Base de datos: Neon, proyecto `cosme-crm-produccion`, org "Cosme SpA", branch `production`.

## Flujo de trabajo con Claude (Cowork)

Esta carpeta (`~/Desktop/cosme-crm` en este Mac) está conectada directamente a las
sesiones de Cowork. Eso significa que Claude puede trabajar sobre estos archivos
directamente — no hace falta mantener una copia aparte en ningún otro lado.

Reglas para quien (o lo que) edite este repo desde Cowork:

1. **Editar en esta carpeta, no en el workspace en la nube.** Los cambios de código
   deben hacerse directo aquí (vía `device_bash`, `sed -i`, un script python de
   lectura-modificación-escritura, o subiendo el archivo completo con
   `device_stage_files` → editar → `device_commit_files`). No mantener una copia
   "espejo" del proyecto en el workspace en la nube — eso generó doble trabajo y
   riesgo de desincronización en el pasado.
2. **`npx tsc --noEmit` corre aquí mismo** (este repo tiene `node_modules` real y
   acceso a internet), así que siempre verificar tipos aquí antes de avisarme que
   algo está listo para commitear.
3. **Nunca correr comandos `git` directo en esta carpeta desde Cowork.** El puente
   remoto no puede borrar/limpiar archivos por defecto, así que un `git add/commit`
   corrido por Cowork puede dejar un `.git/index.lock` colgado. Los comandos git
   (`add`, `commit`, `push`) siempre se los doy a Sebastián para que los corra él
   mismo en su Terminal real.
4. **`.env` nunca se commitea** (ya está en `.gitignore`). Contiene `DATABASE_URL`/
   `DIRECT_URL` de producción (Neon) y `NEXTAUTH_SECRET`. Si hace falta cambiarlos,
   se edita este archivo local, nunca se sube a git ni se pega en el chat sin
   necesidad.
5. **Contraseñas/strings sensibles**: evitar pegarlos en el chat salvo que sea
   estrictamente necesario para resolver un problema puntual (ya pasó una vez con
   la contraseña de la BD de producción). Sebastián prefiere dejar la rotación de
   credenciales para el final del proyecto, no plantearlo de forma proactiva.

## Convenciones del código

- RBAC centralizado en `src/lib/rbac.ts` (`can(role, permission)`).
- Validación de inputs con `zod` en `src/lib/validation.ts`.
- `StockMovement.quantity` es un delta con signo (positivo ENTRADA/AJUSTE+,
  negativo SALIDA/AJUSTE-); `StockLevel.quantity` es el stock acumulado.
- Un `StockMovement` con `saleId` o `purchaseId` no nulo fue generado automáticamente
  por Ventas o Compras — no se puede editar/eliminar/duplicar directo (ver
  `src/app/api/stock-movements/[id]/route.ts`), para no desincronizar esos módulos.
- Categorías de producto: lista curada en `src/lib/product-categories.ts`, es el
  único lugar donde agregar/quitar una categoría (se usa en el desplegable del
  formulario y en la validación del backend).
- Sin librería de íconos externa — los pocos íconos que hay son SVG inline
  (ver `src/components/ui/dropdown-menu.tsx`).

## Historial resumido

- Deploy inicial a Vercel + Neon.
- Fase 03: Compras y Proveedores.
- Importación masiva de productos desde Excel (bulk import).
- Editar/Eliminar/Duplicar en movimientos de inventario creados manualmente
  (Admin-only, oculto para movimientos automáticos de venta/compra) — con menú
  desplegable de tres puntos.
- Categorización de los 100 productos del catálogo real + desplegable de
  categorías en los formularios de producto.
