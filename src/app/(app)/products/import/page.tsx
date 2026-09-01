import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { ProductImport } from "@/components/product-import";

export default async function ProductImportPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "manageProducts")) {
    redirect("/products");
  }

  return <ProductImport />;
}
