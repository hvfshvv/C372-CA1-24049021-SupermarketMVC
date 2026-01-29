function applyPromo(code, subtotal) {
  const clean = (code || '').trim().toUpperCase();
  if (!clean) return { applied: false, discount: 0, message: '' };
  if (clean !== 'SAVE10') return { applied: false, discount: 0, message: 'Promo code not recognized' };
  if (Number(subtotal) < 20) return { applied: false, discount: 0, message: 'Minimum spend $20 required' };
  const discount = Math.min( (Number(subtotal) * 0.10), 6.0);
  return { applied: true, discount: Number(discount.toFixed(2)), message: 'Promo applied: SAVE10' };
}

module.exports = { applyPromo };
