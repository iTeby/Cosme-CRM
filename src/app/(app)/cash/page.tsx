import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { currentShift, expectedCash, shiftTotals } from "@/lib/cash";
import { CashClient } from "@/components/cash-client";

export default async function CashPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "viewCashShift")) {
    redirect("/dashboard");
  }

  const warehouse = await prisma.warehouse.findFirst({ where: { isDefault: true } });

  // El turno abierto y su arqueo en vivo. `expectedCash` no escribe nada: es
  // la misma cuenta que congela el cierre, mostrada antes de cerrar para que
  // el cajero pueda comparar mientras cuenta en vez de descubrir la
  // diferencia después.
  const abierto = warehouse ? await currentShift(prisma, warehouse.id) : null;
  const esperado = abierto ? await expectedCash(prisma, abierto.id) : 0;
  const totales = abierto ? await shiftTotals(prisma, abierto.id) : null;

  const historial = await prisma.cashShift.findMany({
    where: { status: "CERRADO" },
    orderBy: { closedAt: "desc" },
    take: 20,
    include: {
      openedBy: { select: { name: true } },
      closedBy: { select: { name: true } },
    },
  });

  return (
    <CashClient
      shift={abierto ? JSON.parse(JSON.stringify(abierto)) : null}
      expected={esperado}
      totals={totales}
      history={JSON.parse(JSON.stringify(historial))}
      warehouseName={warehouse?.name ?? null}
      canManage={can(session.user.role, "manageCashShift")}
    />
  );
}
