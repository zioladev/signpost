// providers/commerce/provider.js — the commerce reference provider's WebMCP surface.
// Identity and surface_url are derived from location at runtime.
//
// Reader's map for this file:
//   DECLARATION           → ./agent-capabilities.json (served at the origin root)
//   MATERIAL-TERM MAPPING → ./material-terms.js (orderMaterialTerms)
//   AUTHORITY             → kit/authority.js (createAuthority; single-use claim)
//   EXECUTION GATE        → kit/execution-gate.js (guardExecution → mayProceed)
//   MUTATION FUNCTION     → recordOrder() below (the ONLY place an order is created)
//   EVIDENCE EMISSION     → kit/evidence.js (emitEvidence via the gate's emit hook)
//   WEBMCP REGISTRATION   → registerTools() at the bottom
import { registerTools, wrap } from './kit/webmcp.js';
import { createAuthority } from './kit/authority.js';
import { guardExecution } from './kit/execution-gate.js';
import { mountAuthorizePanel, announcePending } from './kit/authorize-panel.js';
import { makeBrowserWaiter } from './kit/await-authorization.js';
import { emitEvidence, setEvidenceContext } from './kit/evidence.js';
import { CATALOG, orderMaterialTerms, money } from './material-terms.js';

const PROVIDER_ID = (location.host || 'commerce').toLowerCase();
const ACTION = 'order_item';
const DEMO = 'Demo — no real order is placed and no payment is taken.';

setEvidenceContext({ surface_url: location.origin, lsKey: 'signpost.commerce.evidence.v1' });
const authority = createAuthority();
mountAuthorizePanel({ authority });

// AWAIT/RESUME: the single order_item call parks here while authorization occurs on
// the page, then resumes through the same exact-term revalidation. The waiter never
// executes; the parked invocation does, via the gate's single-use claim.
const waitForAuthorization = makeBrowserWaiter({ authority, timeoutMs: 45000 });

// ── MUTATION FUNCTION — the only place a mock order is created ────────────────
function recordOrder(terms) {
  const id = 'CM-' + Math.floor(1000 + Math.random() * 9000);
  try {
    const k = 'signpost.commerce.orders';
    const a = JSON.parse(localStorage.getItem(k) || '[]');
    a.push({ id, ...terms, at: new Date().toISOString() });
    localStorage.setItem(k, JSON.stringify(a.slice(-50)));
  } catch {}
  return { id, ...terms };
}

const tools = [
  { name: 'read_catalog',
    description: 'Read the catalog: item ids, names, and unit prices. Read-only; no order is placed.',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      return wrap({ provider: PROVIDER_ID, currency: 'USD', demo: true,
        items: Object.entries(CATALOG).map(([id, v]) => ({
          id,
          name: v.name,
          unit_price: money(v.unit_price_cents),
          order_tool: ACTION,
        })) });
    } },

  { name: 'confirm_price',
    description: 'Confirm the exact price for an item + quantity BEFORE ordering. Deterministic; no order placed.',
    inputSchema: {
      type: 'object',
      properties: {
        item: { type: 'string', enum: Object.keys(CATALOG) },
        quantity: { type: 'integer', minimum: 1, maximum: 20, default: 1 },
      },
      required: ['item'],
    },
    async execute(args) {
      try {
        const t = orderMaterialTerms(args);
        return wrap({
          item: t.item,
          quantity: t.quantity,
          unit_price: money(t.unit_price_cents),
          total: money(t.total_cents),
          currency: t.currency,
          order_tool: ACTION,
        });
      } catch (e) {
        return wrap({ error: String((e && e.message) || e), items: Object.keys(CATALOG) });
      }
    } },

  { name: ACTION,
    description:
      'Place a DEMO order for an item (a CONSEQUENTIAL action). When you call this, an Authorize ' +
      'panel appears on the page and THIS CALL WAITS while the user authorizes these exact terms ' +
      'directly on the page. Do not ask them in chat and do not retry — keep this single call open; ' +
      'it resolves on its own once they authorize (or it times out). It executes only after authorization ' +
      'through the provider page, and only if the exact material terms still match. Returns a confirmation, ' +
      'or a structured block/timeout result. No real order is placed and no payment is taken.',
    inputSchema: {
      type: 'object',
      properties: {
        item: { type: 'string', enum: Object.keys(CATALOG) },
        quantity: { type: 'integer', minimum: 1, maximum: 20, default: 1 },
      },
      required: ['item'],
    },
    async execute(args) {
      let terms;
      try {
        terms = orderMaterialTerms(args);
      } catch (e) {
        return wrap({ error: String((e && e.message) || e), items: Object.keys(CATALOG) });
      }

      // Disclose the exact terms to the provider-local authorization panel.
      announcePending({
        provider_id: PROVIDER_ID,
        action: ACTION,
        material_terms: terms,
        display: `${CATALOG[terms.item].name} ×${terms.quantity} — ${money(terms.total_cents)}`,
      });

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
        mutate: async () => recordOrder(terms),
        awaitAuthorization: { waitFor: waitForAuthorization },
      });

      if (!outcome.executed) {
        return wrap({
          status: outcome.disposition,
          placed: false,
          demo: true,
          proposed: {
            item: terms.item,
            quantity: terms.quantity,
            total: money(terms.total_cents),
          },
          reason: outcome.reason,
          remedy: outcome.remedy,
          note: 'This order was NOT placed. ' + DEMO,
        });
      }

      const o = outcome.result;
      return wrap({
        status: 'confirmed',
        placed: true,
        demo: true,
        order_number: o.id,
        item: o.item,
        quantity: o.quantity,
        total: money(o.total_cents),
        note: DEMO,
      });
    } },
];

registerTools(tools, { onLog: (k) => console.info('[commerce]', k) });
