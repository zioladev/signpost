// tools/verify-vendor.mjs — verify that the vendored
// @zioladev/execution-control package matches the npm-installed published package.
//
// npm verifies the published tarball integrity during installation. This check then
// compares the vendored package against that installed copy byte-for-byte, including
// package metadata, documentation, license files, and dist artifacts. It also verifies
// that neither copy contains package files missing from the other.
//
// The disclosed prior dependency is @zioladev/execution-control@0.1.0.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'vendor/@zioladev/execution-control');
const NPM = join(ROOT, 'node_modules/@zioladev/execution-control');

const EXPECTED_VERSION = '0.1.0';

const walk = (dir, base = dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];

    const path = join(dir, entry.name);

    return entry.isDirectory()
      ? walk(path, base)
      : [relative(base, path)];
  });

const vendorFiles = walk(VENDOR).sort();
const npmFiles = walk(NPM).sort();

const vendorSet = new Set(vendorFiles);
const npmSet = new Set(npmFiles);

let checked = 0;
let diffs = 0;
let missingFromNpm = 0;
let missingFromVendor = 0;

for (const rel of vendorFiles) {
  if (!npmSet.has(rel)) {
    console.log('  MISSING in npm copy:', rel);
    missingFromNpm++;
    continue;
  }

  const vendorBytes = readFileSync(join(VENDOR, rel));
  const npmBytes = readFileSync(join(NPM, rel));

  checked++;

  if (!vendorBytes.equals(npmBytes)) {
    console.log('  DIFFERS from npm copy:', rel);
    diffs++;
  }
}

for (const rel of npmFiles) {
  if (!vendorSet.has(rel)) {
    console.log('  MISSING in vendored copy:', rel);
    missingFromVendor++;
  }
}

const vendorPackage = JSON.parse(
  readFileSync(join(VENDOR, 'package.json'), 'utf8'),
);

const npmPackage = JSON.parse(
  readFileSync(join(NPM, 'package.json'), 'utf8'),
);

const versionOk =
  vendorPackage.version === EXPECTED_VERSION &&
  npmPackage.version === EXPECTED_VERSION;

const ok =
  versionOk &&
  diffs === 0 &&
  missingFromNpm === 0 &&
  missingFromVendor === 0;

console.log(
  `verify:vendor — @zioladev/execution-control v${vendorPackage.version}; ` +
  `${checked} file(s) byte-compared, ${diffs} differ, ` +
  `${missingFromNpm} missing from npm copy, ` +
  `${missingFromVendor} missing from vendored copy — ` +
  `${ok ? 'OK' : 'FAIL'}`,
);

process.exit(ok ? 0 : 1);
