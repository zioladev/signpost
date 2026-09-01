// kit/evidence.js — CHALLENGE-PERIOD work. Shared, identical across providers.
//
// Browser-originated evidence transport to the Signpost collector. Facts are emitted
// to (1) the console, (2) this origin's localStorage, and (3) the collector via a
// CORS simple request — sendBeacon first (survives tab teardown), then a text/plain
// fetch fallback. The collector attributes received facts using the request Origin.
// This is provider-participating evidence, not authenticated or cryptographically
// verified provider evidence.
//
// The provider surface_url is set once at startup with setEvidenceContext() so this
// shared file does not hard-code provider identity.
const COLLECTOR = 'https://signpost.ziola.dev/api/evidence';
const SIMPLE_CT = 'text/plain;charset=UTF-8';
let SURFACE_URL = null;
let LS_KEY = 'signpost.provider.evidence.v1';

export function setEvidenceContext({ surface_url, lsKey } = {}) {
  if (surface_url) SURFACE_URL = surface_url;
  if (lsKey) LS_KEY = lsKey;
}

function ship(body) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = typeof Blob === 'function' ? new Blob([body], { type: SIMPLE_CT }) : body;
      if (navigator.sendBeacon(COLLECTOR, blob)) return;
    }
  } catch {}
  try {
    if (typeof fetch === 'function') {
      fetch(COLLECTOR, { method: 'POST', mode: 'cors', keepalive: true, headers: { 'content-type': SIMPLE_CT }, body }).catch(() => {});
    }
  } catch {}
}

export function emitEvidence(event) {
  const record = { ...event, surface_url: SURFACE_URL };
  try { console.info('[evidence]', record.kind, record.tool || '', record.reason || ''); } catch {}
  try {
    const cur = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    cur.push(record);
    localStorage.setItem(LS_KEY, JSON.stringify(cur.slice(-200)));
  } catch {}
  try { ship(JSON.stringify(record)); } catch {}
}

export default { emitEvidence, setEvidenceContext };
