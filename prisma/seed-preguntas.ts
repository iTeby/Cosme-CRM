// Siembra o actualiza el guion de calificación desde src/lib/qualification.ts.
//
// Las preguntas se habían creado a mano en la base: si alguien reseteaba los
// datos, el guion desaparecía y la ficha del interesado quedaba sin nada que
// preguntar. Este script las repone sin tocar las respuestas ya guardadas:
// busca cada pregunta por su posición y la actualiza, o la crea si falta.
//
// Uso:
//   npm run db:seed:preguntas
import { PrismaClient } from "@prisma/client";
import { PREGUNTAS_GUION } from "../src/lib/qualification";

const prisma = new PrismaClient();
const TENANT = "cosme";

async function main() {
  let creadas = 0;
  let actualizadas = 0;

  for (const pregunta of PREGUNTAS_GUION) {
    // No hay índice único por (tenantId, position), así que el upsert se hace
    // a mano. Borrar y recrear no sirve: se llevaría las respuestas por el
    // onDelete: Cascade de qualification_answers.
    const existente = await prisma.qualificationQuestion.findFirst({
      where: { tenantId: TENANT, position: pregunta.position },
    });

    if (existente) {
      await prisma.qualificationQuestion.update({
        where: { id: existente.id },
        data: {
          block: pregunta.block,
          text: pregunta.text,
          reason: pregunta.reason,
          active: true,
        },
      });
      actualizadas += 1;
    } else {
      await prisma.qualificationQuestion.create({
        data: {
          tenantId: TENANT,
          position: pregunta.position,
          block: pregunta.block,
          text: pregunta.text,
          reason: pregunta.reason,
        },
      });
      creadas += 1;
    }
  }

  // Una pregunta que sobra en la base (quedó de una versión anterior del guion)
  // se desactiva, no se borra: sus respuestas siguen siendo historia del cliente.
  const posiciones = PREGUNTAS_GUION.map((p) => p.position);
  const desactivadas = await prisma.qualificationQuestion.updateMany({
    where: { tenantId: TENANT, active: true, position: { notIn: posiciones } },
    data: { active: false },
  });

  console.log(`Guion listo: ${creadas} creadas, ${actualizadas} actualizadas, ${desactivadas.count} desactivadas.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
