import type { Plan } from "./types";

export const VAT_PERCENT = 15;

/** Display-only monthly prices per ranch. Billing is not implemented. */
export const MONTHLY_PLAN_PRICES_SAR = {
  basic: { beforeVat: 299, includingVat: 344 },
  ultimate: { beforeVat: 999, includingVat: 1149 },
} satisfies Record<Plan, { beforeVat: number; includingVat: number }>;
