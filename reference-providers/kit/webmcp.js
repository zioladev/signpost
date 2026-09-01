// kit/webmcp.js — CHALLENGE-PERIOD work. Shared, identical across providers.
// Native WebMCP registration on document.modelContext, with navigator.modelContext
// and navigator.modelContextTesting fallbacks when available. If no usable
// registerTool surface exists, registration returns cleanly without throwing.
const usable = (c) => c && typeof c.registerTool === 'function';

export function modelContext() {
  const doc = typeof document !== 'undefined' ? document.modelContext : null;
  if (usable(doc)) return doc;
  const nav = typeof navigator !== 'undefined' ? navigator.modelContext : null;
  if (usable(nav)) return nav;
  const test = typeof navigator !== 'undefined' ? navigator.modelContextTesting : null;
  if (usable(test)) return test;
  return doc ?? nav ?? null;
}

export const wrap = (value) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});

export async function registerTools(tools, { onLog } = {}) {
  const mc = modelContext();
  const offered = tools.length;

  if (!mc || typeof mc.registerTool !== 'function') {
    if (onLog) onLog('webmcp_absent');
    return { ok: false, available: !!mc, offered, count: 0 };
  }

  let count = 0, lastErr = '';
  for (const tool of tools) {
    try {
      await mc.registerTool(tool);
      count += 1;
    } catch (err) {
      lastErr = (err && err.message) || String(err);
      console.warn('[webmcp] registerTool failed on', tool.name, err);
    }
  }

  if (onLog) onLog('webmcp_present');
  return {
    ok: count > 0,
    available: true,
    offered,
    count,
    reason: count < offered ? lastErr : undefined,
  };
}

export default { modelContext, wrap, registerTools };
