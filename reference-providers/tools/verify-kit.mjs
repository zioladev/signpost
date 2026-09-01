// tools/verify-kit.mjs — challenge-period kit dependency-boundary check.
//
// The shared kit may use a bare-specifier import for exactly one disclosed prior
// dependency: @zioladev/execution-control. All other imports in kit/*.js must use
// relative or absolute specifiers. This mechanically checks the kit's declared
// JavaScript import boundary; it is not a general provenance analysis.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = join(ROOT, 'kit');
const ALLOWED = new Set(['@zioladev/execution-control']);

let violations = 0;
let files = 0;

for (const file of readdirSync(KIT).filter((name) => name.endsWith('.js'))) {
  files++;

  const src = readFileSync(join(KIT, file), 'utf8');

  const specifiers = [
    ...[...src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1]),
    ...[...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
      (match) => match[1],
    ),
  ];

  for (const specifier of specifiers) {
    const bare =
      !specifier.startsWith('.') &&
      !specifier.startsWith('/');

    if (bare && !ALLOWED.has(specifier)) {
      console.log(
        `  DISALLOWED bare import in kit/${file}: ${specifier}`,
      );
      violations++;
    }
  }
}

console.log(
  `verify:kit — ${files} kit file(s) scanned; ` +
  `bare imports limited to {${[...ALLOWED].join(', ')}} — ` +
  `${violations ? violations + ' VIOLATION(S)' : 'OK'}`,
);

process.exit(violations ? 1 : 0);
