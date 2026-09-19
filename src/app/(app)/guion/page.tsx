import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { GuionCalificacion } from "@/components/guion-calificacion";

// El guion suelto: para atender a alguien que recién llamó o escribió, cuando
// todavía no hay ficha que abrir. Lee las preguntas de la base —las mismas que
// usa la ficha del interesado— para que no existan dos guiones distintos.
export default async function GuionPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "manageCustomers")) {
    redirect("/dashboard");
  }

  const questions = await prisma.qualificationQuestion.findMany({
    where: { active: true },
    orderBy: { position: "asc" },
    select: { id: true, position: true, block: true, text: true, reason: true },
  });

  return <GuionCalificacion questions={questions} />;
}
