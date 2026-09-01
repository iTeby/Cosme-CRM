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
// Si no defines las variables, usa valores por defecto que DEBES cambiar
// apenas inicies sesión.
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

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
  const password = process.env.SEED_ADMIN_PASSWORD || "CambiaEstaClave123!";

  const passwordHash = await hash(password, 10);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`El usuario ${email} ya existe, no se modificó.`);
  } else {
    await prisma.user.create({
      data: { email, name, role: "ADMIN", passwordHash },
    });
    console.log("Usuario administrador creado:");
    console.log(`  ${email} / ${password}`);
    console.log("Inicia sesión y cambia esta contraseña de inmediato desde Usuarios.");
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
