// providers/readonly/provider.js — the read-only reference provider's WebMCP surface.
//
// This provider has no execution control by design: its capabilities are pure
// inspections. It imports no authority, execution gate, or execution-control package.
// The execution-control seam is therefore absent from this read-only provider.
//
// Reader's map:
//   DECLARATION          → ./agent-capabilities.json (origin root)
//   WEBMCP REGISTRATION  → registerTools() at the bottom
//   (no material terms, authority, gate, mutation, or execution evidence — by design)
import { registerTools, wrap } from './kit/webmcp.js';

const PROVIDER_ID = (location.host || 'readonly').toLowerCase();

// A tiny static dataset to inspect. Nothing here mutates.
const PALETTES = {
  harbor: ['#0b1f2a', '#123b4f', '#2e6c86', '#7fb0c4'],
  ember:  ['#2a0d09', '#8b3a1f', '#d98a4a', '#f0c88b'],
};

const norm = (h) => {
  const s = String(h || '').trim().toLowerCase();
  return s.startsWith('#') ? s : '#' + s;
};

const tools = [
  {
    name: 'list_palettes',
    description: 'List palette names and their hex tokens. Read-only.',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      return wrap({ provider: PROVIDER_ID, demo: true, palettes: PALETTES });
    },
  },

  {
    name: 'check_palette',
    description:
      'Check whether a hex color is present in a named palette. A READ-ONLY inspection — nothing ' +
      'changes, and no authorization is involved (execution control does not apply to this read).',
    inputSchema: {
      type: 'object',
      properties: {
        palette: { type: 'string', enum: Object.keys(PALETTES) },
        hex: { type: 'string', description: 'e.g. #FF0000' },
      },
      required: ['palette', 'hex'],
    },
    async execute({ palette, hex }) {
      const tokens = PALETTES[palette];
      if (!tokens) {
        return wrap({ error: 'unknown palette', palettes: Object.keys(PALETTES) });
      }

      const h = norm(hex);
      const present = tokens.map(norm).includes(h);

      return wrap({
        provider: PROVIDER_ID,
        palette,
        hex: h,
        present,
        tokens,
        note: 'read-only — no execution-control gate; nothing mutates',
      });
    },
  },
];

registerTools(tools, { onLog: (k) => console.info('[readonly]', k) });
