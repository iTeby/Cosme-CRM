// Cómo se cobra un producto. Espejo del enum PricingType del esquema.
export const PRICING_TYPES = ["FIJO", "COTIZADO", "SUSCRIPCION"] as const;

export type PricingType = (typeof PRICING_TYPES)[number];

export const pricingTypeLabels: Record<PricingType, string> = {
  FIJO: "Precio fijo",
  COTIZADO: "Cotizado por proyecto",
  SUSCRIPCION: "Suscripción",
};
