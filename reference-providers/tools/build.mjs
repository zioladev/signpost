// tools/build.mjs — the assembler. Each provider deploys to its OWN origin, so it
// must be self-contained; this copies the canonical shared kit (and, for the gated
// providers, the vendored prior package) into a self-contained dist/<provider>/.
// This is a plain file copy — no framework, no transpile.
//
//   node tools/build.mjs            → build all three
//   node tools/build.mjs booking    → build one
import {
  cpSync,
  mkdirSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const GATED_KIT = [
  'authority.js',
  'execution-gate.js',
  'authorize-gesture.js',
  'authorize-panel.js',
  'authorize-events.js',
  'await-authorization.js',
  'evidence.js',
  'webmcp.js',
];

const READONLY_KIT = [
  'webmcp.js',
];

const PROVIDERS = {
  commerce: {
    kit: GATED_KIT,
    vendor: true,
  },
  booking: {
    kit: GATED_KIT,
    vendor: true,
  },
  readonly: {
    kit: READONLY_KIT,
    vendor: false,
  },
};

const only = process.argv[2];

for (const [name, cfg] of Object.entries(PROVIDERS)) {
  if (only && only !== name) continue;

  const src = join(ROOT, 'providers', name);
  const out = join(ROOT, 'dist', name);

  rmSync(out, {
    recursive: true,
    force: true,
  });

  mkdirSync(out, {
    recursive: true,
  });

  for (const file of readdirSync(src)) {
    cpSync(
      join(src, file),
      join(out, file),
    );
  }

  mkdirSync(join(out, 'kit'), {
    recursive: true,
  });

  for (const file of cfg.kit) {
    cpSync(
      join(ROOT, 'kit', file),
      join(out, 'kit', file),
    );
  }

  if (cfg.vendor) {
    cpSync(
      join(ROOT, 'vendor'),
      join(out, 'vendor'),
      { recursive: true },
    );
  }

  console.log(
    `built dist/${name}  ` +
    `(kit: ${cfg.kit.length} file(s)` +
    `${cfg.vendor
      ? ' + vendored @zioladev/execution-control'
      : ', no execution-control — read-only'})`,
  );
}
