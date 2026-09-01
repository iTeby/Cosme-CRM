import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { ProductForm } from "@/components/product-form";

export default async function NewProductPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!can(session.user.role, "manageProducts")) {
    redirect("/products");
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold text-brand-900">Nuevo producto</h1>
      <p className="mb-6 text-sm text-slate-500">
        Cada producto necesita al menos una variante con su propio SKU. Puedes agregar más
        adelante.
      </p>
      <ProductForm />
    </div>
  );
}
