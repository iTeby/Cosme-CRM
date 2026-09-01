import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { UserManagement } from "@/components/user-management";

export default async function UsersPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "manageUsers")) {
    redirect("/dashboard");
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      createdAt: true,
    },
  });

  return (
    <UserManagement users={JSON.parse(JSON.stringify(users))} currentUserId={session.user.id} />
  );
}
