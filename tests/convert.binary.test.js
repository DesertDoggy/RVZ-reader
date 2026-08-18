'use strict';

const fs = require('fs/promises');
const { createReadStream } = require('fs');
const crypto = require('crypto');
const path = require('path');
const { rvzToIso } = require('../src/index');

const SAMPLES_DIR = path.join(__dirname, '..', 'samples');

// Pairs of (rvz, reference iso) to byte-compare exactly. Unlike the RA-hash
// tests, this catches every difference (including junk/PRNG regions) so the
// PRNG implementation can be analyzed and fixed.
const CASES = [
  { rvz: 'GC.rvz', iso: 'GC.iso' },
  { rvz: 'GCbzip2.rvz', iso: 'GC.iso' },
  { rvz: 'GClzma.rvz', iso: 'GC.iso' },
  { rvz: 'GClzma2.rvz', iso: 'GC.iso' },
  { rvz: 'GCNoComp.rvz', iso: 'GC.iso' },
  { rvz: 'GCzstd2M.rvz', iso: 'GC.iso' },
  { rvz: 'GCzstd32k.rvz', iso: 'GC.iso' },
  { rvz: 'GCzstd512k.rvz', iso: 'GC.iso' },
  { rvz: 'Wii.rvz', iso: 'Wii.iso' },
  { rvz: 'Wiibzip2.rvz', iso: 'Wii.iso' },
  { rvz: 'Wiilzma.rvz', iso: 'Wii.iso' },
  { rvz: 'Wiilzma2.rvz', iso: 'Wii.iso' },
  { rvz: 'WiiNoComp.rvz', iso: 'Wii.iso' },
  { rvz: 'Wiizstd2M.rvz', iso: 'Wii.iso' },
  { rvz: 'Wiizstd32K.rvz', iso: 'Wii.iso' },
];

// Streams the file through sha256 instead of loading it into memory, since
// disc images can exceed the 2 GiB limit fs.readFile refuses to load whole.
function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// Groups consecutive differing byte indices into [start, end) ranges so a
// wall of individual byte offsets doesn't flood the output. Compares in
// fixed-size chunks via file handles so files larger than 2 GiB (which
// fs.readFile refuses to load whole) work fine. Only called when the
// whole-file hashes already disagree, to pinpoint exactly what differs.
async function diffRanges(pathA, pathB) {
  const [handleA, handleB] = await Promise.all([fs.open(pathA, 'r'), fs.open(pathB, 'r')]);
  try {
    const [statA, statB] = await Promise.all([handleA.stat(), handleB.stat()]);
    const ranges = [];
    if (statA.size !== statB.size) {
      ranges.push(['length mismatch', statA.size, statB.size]);
    }

    const CHUNK_SIZE = 16 * 1024 * 1024;
    const bufA = Buffer.alloc(CHUNK_SIZE);
    const bufB = Buffer.alloc(CHUNK_SIZE);
    const total = Math.min(Number(statA.size), Number(statB.size));
    let rangeStart = -1;
    for (let offset = 0; offset < total; offset += CHUNK_SIZE) {
      const size = Math.min(CHUNK_SIZE, total - offset);
      const [{ bytesRead: readA }, { bytesRead: readB }] = await Promise.all([
        handleA.read(bufA, 0, size, offset),
        handleB.read(bufB, 0, size, offset),
      ]);
      const n = Math.min(readA, readB);
      for (let i = 0; i < n; i++) {
        if (bufA[i] !== bufB[i]) {
          if (rangeStart === -1) rangeStart = offset + i;
        } else if (rangeStart !== -1) {
          ranges.push([rangeStart, offset + i]);
          rangeStart = -1;
        }
      }
    }
    if (rangeStart !== -1) ranges.push([rangeStart, total]);
    return ranges;
  } finally {
    await handleA.close();
    await handleB.close();
  }
}

async function run() {
  let failures = 0;
  const referenceHashes = new Map();

  for (const { rvz, iso } of CASES) {
    const rvzPath = path.join(SAMPLES_DIR, rvz);
    const isoPath = path.join(SAMPLES_DIR, iso);
    const outPath = path.join(SAMPLES_DIR, `_bintest_${rvz}.iso`);
    try {
      await rvzToIso(rvzPath, outPath);

      if (!referenceHashes.has(iso)) {
        referenceHashes.set(iso, await sha256(isoPath));
      }
      const expectedHash = referenceHashes.get(iso);
      const actualHash = await sha256(outPath);

      if (actualHash === expectedHash) {
        console.log(`PASS ${rvz} (vs ${iso}): sha256 ${actualHash}`);
        continue;
      }

      failures++;
      console.log(`FAIL ${rvz} (vs ${iso}): sha256 mismatch (expected ${expectedHash}, got ${actualHash})`);
      const ranges = await diffRanges(isoPath, outPath);
      const totalDiffBytes = ranges
        .filter((r) => typeof r[0] === 'number')
        .reduce((sum, [start, end]) => sum + (end - start), 0);
      console.log(`  ${ranges.length} differing range(s), ${totalDiffBytes} byte(s) total`);
      for (const range of ranges.slice(0, 20)) {
        if (range[0] === 'length mismatch') {
          console.log(`  length mismatch: expected ${range[1]}, actual ${range[2]}`);
        } else {
          const [start, end] = range;
          console.log(`  [0x${start.toString(16)}, 0x${end.toString(16)}) (${end - start} bytes)`);
        }
      }
      if (ranges.length > 20) console.log(`  ... and ${ranges.length - 20} more range(s)`);
    } catch (err) {
      console.log(`FAIL ${rvz}: ${err.message}`);
      failures++;
    } finally {
      await fs.rm(outPath, { force: true });
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll binary-exact tests passed.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
