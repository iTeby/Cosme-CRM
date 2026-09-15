// Seed liviano para producción: a diferencia de prisma/seed.ts (que carga
// un catálogo de ejemplo para pruebas), este script SOLO crea la bodega por
// defecto y un primer usuario ADMIN, para que el negocio parta con datos
// reales y no con productos de prueba.
//
// Uso:
//   SEED_ADMIN_EMAIL="tu@correo.cl" \
//   SEED_ADMIN_NAME="Tu Nombre" \
//   SEED_ADMIN_PASSWORD="una-clave-segura" \
//   npm run db:seed:prod
//
// SEED_ADMIN_PASSWORD ya no tiene valor por defecto. Antes, si no la
// definías, la cuenta ADMIN de producción quedaba con "CambiaEstaClave123!":
// una clave conocida, escrita en el repositorio, en la base real. El aviso de
// "cámbiala apenas inicies sesión" no sirve de nada si alguien entra antes.
// Ahora, si no la defines, se genera una al azar y se imprime una sola vez.
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

async function main() {
  let warehouse = await prisma.warehouse.findFirst({ where: { isDefault: true } });
  if (!warehouse) {
    warehouse = await prisma.warehouse.create({
      data: { name: "Bodega Central", isDefault: true },
    });
  }

  const email = process.env.SEED_ADMIN_EMAIL || "admin@cosme.cl";
  const name = process.env.SEED_ADMIN_NAME || "Administrador";
  const passwordDelEntorno = process.env.SEED_ADMIN_PASSWORD;
  const generada = !passwordDelEntorno;
  const password = passwordDelEntorno || randomBytes(18).toString("base64url");

  const passwordHash = await hash(password, 10);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`El usuario ${email} ya existe, no se modificó.`);
  } else {
    await prisma.user.create({
      data: { email, name, role: "ADMIN", passwordHash },
    });
    console.log("Usuario administrador creado:");
    if (generada) {
      console.log(`  ${email}`);
      console.log(`  Contraseña generada al azar: ${password}`);
      console.log("Guárdala ahora: no se vuelve a mostrar y no queda en ningún archivo.");
    } else {
      console.log(`  ${email} (con la contraseña de SEED_ADMIN_PASSWORD)`);
    }
    console.log("Inicia sesión y cámbiala de inmediato desde Usuarios.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
