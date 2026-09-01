// kit/authorize-panel.js — CHALLENGE-PERIOD work. Shared, identical across the
// gated providers. The provider-local authorization UI, in plain JS (no framework).
//
// When a provider tool proposes a consequential action it calls announcePending();
// this panel discloses the exact proposed terms and waits for authorization through
// the visible control. The click is checked by authorize-gesture.js before this
// panel calls authority.authorize().
import { authorizeFromGesture } from './authorize-gesture.js';
import { PENDING_EVENT, AUTHORIZED_EVENT } from './authorize-events.js';

// Snapshot the material terms placed on the event so the event-visible object is NOT
// the same reference the candidate/execution path retains. A page-script listener that
// mutates event.detail.material_terms then cannot reach the execution candidate.
function snapshotTerms(t) {
  if (!t || typeof t !== 'object') return t;
  try { return structuredClone(t); } catch { return JSON.parse(JSON.stringify(t)); }
}

// Called by a provider tool to disclose proposed terms to the human panel.
export function announcePending(proposal) {
  if (typeof window === 'undefined') return;
  const detail = proposal && typeof proposal === 'object'
    ? { ...proposal, material_terms: snapshotTerms(proposal.material_terms) }
    : proposal;
  window.dispatchEvent(new CustomEvent(PENDING_EVENT, { detail }));
}

const STYLE = `
#authorize-panel{position:fixed;left:16px;bottom:16px;z-index:70;max-width:340px;background:rgba(20,17,15,.94);
  color:#f4efe6;border:1px solid rgba(244,239,230,.18);border-radius:12px;padding:14px 16px;backdrop-filter:blur(6px);
  box-shadow:0 10px 34px -14px rgba(0,0,0,.6);font-family:'Helvetica Neue',Helvetica,Arial,sans-serif}
#authorize-panel .ah{display:flex;align-items:center;gap:8px;font:500 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.2em;
  text-transform:uppercase;color:rgba(244,239,230,.5);margin-bottom:8px}
#authorize-panel .adot{width:6px;height:6px;border-radius:50%;background:#c98a5c;flex:none}
#authorize-panel .aterms{margin:0 0 12px;font-size:15px;line-height:1.4}
#authorize-panel .arow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
#authorize-panel button{font:inherit;font-size:13px;padding:8px 14px;border-radius:8px;border:1px solid #c98a5c;
  background:rgba(201,138,92,.18);color:#f4efe6;cursor:pointer}
#authorize-panel button:disabled{opacity:.5;cursor:default}
#authorize-panel .astatus{font:400 11px/1.3 ui-monospace,Menlo,monospace;color:#c98a5c}
#authorize-panel .anote{margin:10px 0 0;font-size:11.5px;line-height:1.5;color:rgba(244,239,230,.5)}`;

export function mountAuthorizePanel({ authority, emit } = {}) {
  if (typeof document === 'undefined') return null; // Node no-op

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const panel = document.createElement('section');
  panel.id = 'authorize-panel';
  panel.hidden = true;
  panel.setAttribute('aria-live', 'polite');
  panel.innerHTML =
    '<div class="ah"><span class="adot"></span> Authorize action</div>' +
    '<p class="aterms" id="authz-terms">—</p>' +
    '<div class="arow"><button id="authz-btn" type="button">Authorize these exact terms</button>' +
    '<span class="astatus" id="authz-status"></span></div>' +
    '<p class="anote">This consequential action requires your authorization of these exact terms. ' +
    'If the terms change before it runs, it will not be executed. Demo — nothing is charged.</p>';
  document.body.appendChild(panel);

  const termsEl = panel.querySelector('#authz-terms');
  const btn = panel.querySelector('#authz-btn');
  const statusEl = panel.querySelector('#authz-status');
  let pending = null;

  window.addEventListener(PENDING_EVENT, (e) => {
    pending = e.detail || {};
    termsEl.textContent = pending.display || JSON.stringify(pending.material_terms || {});
    statusEl.textContent = '';
    btn.disabled = false;
    panel.hidden = false;
  });

  btn.addEventListener('click', async (event) => {
    if (!pending) return;

    const result = await authorizeFromGesture(event, {
      authority,
      proposal: {
        provider_id: pending.provider_id,
        action: pending.action,
        material_terms: pending.material_terms,
      },
      onReject: () => {
        statusEl.textContent = 'refused — untrusted (scripted) gesture';
        console.warn('[authorize] refused: gesture was not a trusted user activation');
      },
    });

    if (!result.authorized) return;
    btn.disabled = true;
    statusEl.textContent = `authorized ✓ (${String(result.auth.authorization_id).slice(0, 12)}…)`;
    window.dispatchEvent(new CustomEvent(AUTHORIZED_EVENT, { detail: result.auth }));
  });

  return { panel };
}

export default { mountAuthorizePanel, announcePending };
