#!/usr/bin/env node
'use strict';

// Builds a standalone rvz2iso executable for the CURRENT platform/arch only,
// into release/<platform>-<arch>/. Native addons (zstd, lzma-native) are
// platform-specific, so this same script must be run separately on each
// target OS (locally or in per-OS CI jobs) to produce every platform's build.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RELEASE_DIR = path.join(ROOT, 'release');

// @mongodb-js/zstd requires Node >= 20.19 to install, but that's only an npm
// engines check -- N-API addons work with any Node build supporting the same
// N-API version. Pin an exact patch that pkg-fetch actually has a prebuilt
// base uploaded for (check node_modules/@yao-pkg/pkg-fetch/lib-es5/expected-shas.json
// if this ever needs bumping -- unqualified "node20" resolves to whatever the
// newest listed patch is, which isn't always actually uploaded yet).
const NODE_ABI = 'node22.23.2';

const PKG_PLATFORM = { win32: 'win', darwin: 'macos', linux: 'linux' };
const PKG_ARCH = { x64: 'x64', arm64: 'arm64', ia32: 'x86' };

function pkgTarget() {
  const platform = PKG_PLATFORM[process.platform];
  const arch = PKG_ARCH[process.arch];
  if (!platform || !arch) {
    throw new Error(`Unsupported platform/arch for packaging: ${process.platform}/${process.arch}`);
  }
  return `${NODE_ABI}-${platform}-${arch}`;
}

function main() {
  const target = pkgTarget();
  const outDir = path.join(RELEASE_DIR, `${process.platform}-${process.arch}`);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const exeName = process.platform === 'win32' ? 'rvz2iso.exe' : 'rvz2iso';
  const outFile = path.join(outDir, exeName);
  const pkgBin = path.join(
    ROOT,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'pkg.cmd' : 'pkg'
  );

  console.log(`Building target ${target} -> ${path.relative(ROOT, outFile)}`);
  execFileSync(pkgBin, ['.', '--targets', target, '--output', outFile], {
    cwd: ROOT,
    stdio: 'inherit',
    // .cmd shims on Windows aren't directly spawnable; routing through the shell handles that.
    shell: true,
  });

  console.log(`\nDone. Release output: ${path.relative(ROOT, outDir)}`);
}

main();
