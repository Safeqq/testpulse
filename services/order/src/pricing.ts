// Logika harga dibuat murni (tanpa I/O) supaya mudah di-unit-test, termasuk boundary value.

export const SHIPPING_FEE = 15_000;
/** Gratis ongkir jika subtotal (sebelum diskon) >= nilai ini. */
export const FREE_SHIPPING_THRESHOLD = 250_000;

interface PromoRule {
  percent: number;
  minSubtotal: number;
  maxDiscount: number;
}

export const PROMO_CODES: Readonly<Record<string, PromoRule>> = {
  HEMAT10: { percent: 10, minSubtotal: 100_000, maxDiscount: 50_000 },
  MAHASISWA: { percent: 15, minSubtotal: 200_000, maxDiscount: 75_000 },
};

export type PricingErrorCode = "INVALID_PROMO_CODE" | "PROMO_NOT_ELIGIBLE";

export class PricingError extends Error {
  constructor(
    readonly code: PricingErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface PricedLine {
  unitPrice: number;
  quantity: number;
}

export interface Totals {
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
}

export function normalizePromoCode(code: string): string {
  return code.trim().toUpperCase();
}

export function calculateTotals(lines: readonly PricedLine[], promoCode?: string): Totals {
  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);

  let discount = 0;
  if (promoCode !== undefined) {
    const code = normalizePromoCode(promoCode);
    const rule = PROMO_CODES[code];
    if (!rule) throw new PricingError("INVALID_PROMO_CODE", `Kode promo ${code} tidak valid`);
    if (subtotal < rule.minSubtotal) {
      throw new PricingError("PROMO_NOT_ELIGIBLE", `Kode promo ${code} memerlukan minimal belanja Rp${rule.minSubtotal}`);
    }
    discount = Math.min(Math.floor((subtotal * rule.percent) / 100), rule.maxDiscount);
  }

  const shipping = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
  return { subtotal, discount, shipping, total: subtotal - discount + shipping };
}
