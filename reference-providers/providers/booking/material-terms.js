// providers/booking/material-terms.js — PROVIDER-SPECIFIC (challenge-period).
// `time` is a bound material field, so a single-field time change (10:00 -> 10:30)
// is a clean divergence at execution. Canonical ids + integer cents only.
export const SERVICES = {
  haircut:       { name: 'Haircut',            duration_min: 30, price_cents: 4500 },
  cut_and_beard: { name: 'Cut & Beard Trim',   duration_min: 60, price_cents: 6000 },
};
// Both 10:00 and 10:30 are offered, so the drift case uses two real, bookable slots.
export const SLOTS = ['09:30', '10:00', '10:30', '11:00'];

export function bookingMaterialTerms({ service, date, time, stylist }) {
  const s = SERVICES[service];
  if (!s) throw new Error('unknown service: ' + service);
  return { service, stylist: stylist || 'standard', date, time, duration_min: s.duration_min, currency: 'USD', total_cents: s.price_cents };
}

export const money = (cents) => '$' + (cents / 100).toFixed(2);
