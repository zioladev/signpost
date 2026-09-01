// providers/booking/provider.js — the booking reference provider's WebMCP surface.
// Identity and surface_url are derived from location at runtime.
//
// Reader's map:
//   DECLARATION            → ./agent-capabilities.json (origin root)
//   MATERIAL-TERM MAPPING  → ./material-terms.js (bookingMaterialTerms; `time` is bound)
//   AUTHORITY              → kit/authority.js (createAuthority; single-use claim)
//   EXECUTION GATE         → kit/execution-gate.js (guardExecution → mayProceed)
//   MUTATION FUNCTION      → recordBooking() below (the ONLY place a booking is made)
//   EVIDENCE EMISSION      → kit/evidence.js (via the gate's emit hook)
//   WEBMCP REGISTRATION    → registerTools() at the bottom
import { registerTools, wrap } from './kit/webmcp.js';
import { createAuthority } from './kit/authority.js';
import { guardExecution } from './kit/execution-gate.js';
import { mountAuthorizePanel, announcePending } from './kit/authorize-panel.js';
import { makeBrowserWaiter } from './kit/await-authorization.js';
import { emitEvidence, setEvidenceContext } from './kit/evidence.js';
import { SERVICES, SLOTS, bookingMaterialTerms, money } from './material-terms.js';

const PROVIDER_ID = (location.host || 'booking').toLowerCase();
const ACTION = 'book_appointment';
const DEMO = 'Demo — no real appointment is booked and no payment is taken.';

setEvidenceContext({ surface_url: location.origin, lsKey: 'signpost.booking.evidence.v1' });
const authority = createAuthority();
mountAuthorizePanel({ authority });

// AWAIT/RESUME: the single book_appointment call parks here while authorization
// occurs on the page, then resumes through the same exact-term revalidation. The
// waiter never executes; the parked invocation does, via the gate's single-use claim.
const waitForAuthorization = makeBrowserWaiter({ authority, timeoutMs: 45000 });

// ── MUTATION FUNCTION — the only place a mock booking is created ──────────────
function recordBooking(terms) {
  const id = 'BK-' + Math.floor(1000 + Math.random() * 9000);
  try {
    const k = 'signpost.booking.bookings';
    const a = JSON.parse(localStorage.getItem(k) || '[]');
    a.push({ id, ...terms, at: new Date().toISOString() });
    localStorage.setItem(k, JSON.stringify(a.slice(-50)));
  } catch {}
  return { id, ...terms };
}

const tools = [
  { name: 'read_services',
    description: 'Read bookable services (ids, names, durations, prices). Read-only.',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      return wrap({ provider: PROVIDER_ID, currency: 'USD', demo: true,
        services: Object.entries(SERVICES).map(([id, v]) => ({ id, name: v.name, duration_min: v.duration_min, price: money(v.price_cents) })) });
    } },

  { name: 'find_available_appointment',
    description: 'List available times for a service on a date. Read-only; nothing is booked. Provide `date` (YYYY-MM-DD).',
    inputSchema: { type: 'object', properties: { service: { type: 'string', enum: Object.keys(SERVICES) }, date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['date'] },
    async execute({ service, date }) {
      return wrap({ provider: PROVIDER_ID, service: service || 'haircut', date, available_times: SLOTS, book_tool: ACTION });
    } },

  { name: ACTION,
    description:
      'Book a DEMO appointment (a CONSEQUENTIAL action). When you call this, an Authorize panel appears ' +
      'on the page and THIS CALL WAITS while the user authorizes these exact terms directly on the page. ' +
      'Do not ask them in chat and do not retry — keep this single call open; it resolves on its own once ' +
      'they authorize (or it times out). It executes only after authorization through the provider page, ' +
      'and only if the exact material terms still match. Returns a confirmation, or a structured ' +
      'block/timeout result. No real appointment is booked and no payment is taken.',
    inputSchema: { type: 'object', properties: {
      service: { type: 'string', enum: Object.keys(SERVICES), default: 'haircut' },
      date: { type: 'string', description: 'YYYY-MM-DD' },
      time: { type: 'string', description: 'HH:MM (24h), e.g. 10:00', enum: SLOTS },
      stylist: { type: 'string', default: 'standard' },
    }, required: ['date', 'time'] },
    async execute(args) {
      let terms;
      try { terms = bookingMaterialTerms({ service: args.service || 'haircut', date: args.date, time: args.time, stylist: args.stylist }); }
      catch (e) { return wrap({ error: String((e && e.message) || e), services: Object.keys(SERVICES) }); }

      announcePending({ provider_id: PROVIDER_ID, action: ACTION, material_terms: terms,
        display: `${SERVICES[terms.service].name} · ${terms.date} ${terms.time} — ${money(terms.total_cents)}` });

      const candidate = {
        provider: PROVIDER_ID,
        tool: ACTION,
        arguments: { material_terms: terms },
        effect: 'state-changing',
      };

      const outcome = await guardExecution({
        candidate,
        authority,
        emit: emitEvidence,
        mutate: async () => recordBooking(terms),
        awaitAuthorization: { waitFor: waitForAuthorization },
      });

      if (!outcome.executed) {
        return wrap({ status: outcome.disposition, booked: false, demo: true,
          proposed: { service: terms.service, date: terms.date, time: terms.time, total: money(terms.total_cents) },
          reason: outcome.reason, remedy: outcome.remedy, note: 'This appointment was NOT booked. ' + DEMO });
      }

      const b = outcome.result;
      return wrap({ status: 'confirmed', booked: true, demo: true, booking_number: b.id,
        service: b.service, date: b.date, time: b.time, total: money(b.total_cents), note: DEMO });
    } },
];

registerTools(tools, { onLog: (k) => console.info('[booking]', k) });
