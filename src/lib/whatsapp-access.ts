import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function canAccessWhatsApp() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return false;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true, active: true } });
  return Boolean(user?.active && user.email.toLowerCase() === "isebi@me.com");
}
