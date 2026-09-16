import { redirect } from "next/navigation";
import { canAccessWhatsApp } from "@/lib/whatsapp-access";
import { WhatsAppInbox } from "@/components/whatsapp-inbox";

export default async function WhatsAppPage() {
  if (!(await canAccessWhatsApp())) redirect("/dashboard");
  return <WhatsAppInbox />;
}
