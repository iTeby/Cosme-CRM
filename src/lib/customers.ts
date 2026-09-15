// Etapas de un interesado y de dónde llegó. Espejo de los enums del esquema.
export const CUSTOMER_STAGES = ["NUEVO", "CALIFICADO", "COTIZADO", "CLIENTE", "PERDIDO"] as const;
export type CustomerStage = (typeof CUSTOMER_STAGES)[number];

export const customerStageLabels: Record<CustomerStage, string> = {
  NUEVO: "Nuevo",
  CALIFICADO: "Calificado",
  COTIZADO: "Cotizado",
  CLIENTE: "Cliente",
  PERDIDO: "Perdido",
};

export const customerStageTone: Record<CustomerStage, "neutral" | "good" | "warn" | "critical"> = {
  NUEVO: "neutral",
  CALIFICADO: "warn",
  COTIZADO: "warn",
  CLIENTE: "good",
  PERDIDO: "critical",
};

export const LEAD_SOURCES = ["WHATSAPP", "WEB", "DEMO", "REFERIDO", "OTRO"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const leadSourceLabels: Record<LeadSource, string> = {
  WHATSAPP: "WhatsApp",
  WEB: "Sitio web",
  DEMO: "Demo en vivo",
  REFERIDO: "Referido",
  OTRO: "Otro",
};
