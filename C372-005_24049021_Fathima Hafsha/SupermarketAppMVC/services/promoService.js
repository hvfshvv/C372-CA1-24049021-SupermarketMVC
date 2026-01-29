const db = require("../db");

/**
 * Apply a promo code using DB-backed codes when available; fallback to legacy SAVE10.
 * Returns: { applied, discount, message, code, percent }
 */
async function applyPromo(code, subtotal) {
  const clean = (code || "").trim().toUpperCase();
  const sub = Number(subtotal) || 0;
  if (!clean) return { applied: false, discount: 0, message: "" };

  // Try promo_codes table if present
  try {
    const promo = await new Promise((resolve, reject) => {
      db.query(
        `SELECT code, discount_percent, expiry, active
           FROM promo_codes
          WHERE code = ? AND active = 1 AND (expiry IS NULL OR expiry >= NOW())
          LIMIT 1`,
        [clean],
        (err, rows) => (err ? reject(err) : resolve(rows && rows[0]))
      );
    });
    if (promo) {
      const pct = Math.max(0, Math.min(Number(promo.discount_percent) || 0, 100));
      const discount = Number((sub * (pct / 100)).toFixed(2));
      return {
        applied: discount > 0,
        discount,
        message: `Promo applied: ${promo.code} (${pct}% off)`,
        code: promo.code,
        percent: pct,
      };
    }
  } catch (e) {
    console.warn("promo lookup failed, falling back to legacy rule:", e.message);
  }

  // Legacy SAVE10 fallback
  if (clean !== "SAVE10") return { applied: false, discount: 0, message: "Promo code not recognized" };
  if (sub < 20) return { applied: false, discount: 0, message: "Minimum spend $20 required" };
  const discount = Math.min(sub * 0.1, 6.0);
  return { applied: true, discount: Number(discount.toFixed(2)), message: "Promo applied: SAVE10", code: "SAVE10", percent: 10 };
}

module.exports = { applyPromo };
