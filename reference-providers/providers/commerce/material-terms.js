// providers/commerce/material-terms.js — PROVIDER-SPECIFIC (challenge-period).
// Maps a purchase request to the EXACT material terms a human authorizes and the
// authority revalidates. Canonical ids + integer cents only — no display strings are
// bound (those are for humans, not the fingerprint).
export const CATALOG = {
  house_blend:   { name: 'House Blend — Whole Bean (12 oz)', unit_price_cents: 1800 },
  cold_brew_kit: { name: 'Cold Brew Kit',                    unit_price_cents: 2600 },
};

export function orderMaterialTerms({ item, quantity }) {
  const it = CATALOG[item];
  if (!it) throw new Error('unknown item: ' + item);
  const qty = Math.max(1, Math.min(20, Math.round(Number(quantity) || 1)));
  return { item, quantity: qty, unit_price_cents: it.unit_price_cents, total_cents: it.unit_price_cents * qty, currency: 'USD' };
}

export const money = (cents) => '$' + (cents / 100).toFixed(2);
