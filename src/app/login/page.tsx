import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await getServerSession(authOptions);
  if (session) redirect("/dashboard");

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-sm font-medium uppercase tracking-widest text-brand-200">
            Cosme CRM
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-white">
            Control de inventario
          </h1>
        </div>
        <div className="rounded-xl bg-white p-6 shadow-xl">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
