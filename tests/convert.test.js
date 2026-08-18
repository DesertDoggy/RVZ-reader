'use strict';

const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { rvzToIso } = require('../src/index');

const execFileAsync = promisify(execFile);

const SAMPLES_DIR = path.join(__dirname, '..', 'samples');
const RAHASHER_PATH = path.join(SAMPLES_DIR, 'RAHasher.exe');

// Each group shares one reference ISO; every .rvz variant in the group must
// produce the same RetroAchievements hash as that reference ISO.
const GROUPS = [
  {
    referenceIso: 'GC.iso',
    rvzFiles: [
      'GC.rvz',
      'GCbzip2.rvz',
      'GClzma.rvz',
      'GClzma2.rvz',
      'GCNoComp.rvz',
      'GCzstd2M.rvz',
      'GCzstd32k.rvz',
      'GCzstd512k.rvz',
    ],
  },
  {
    referenceIso: 'Wii.iso',
    rvzFiles: ['Wii.rvz', 'Wiibzip2.rvz', 'Wiilzma.rvz', 'Wiilzma2.rvz', 'WiiNoComp.rvz'],
  },
];

const HASH_RE = /Generated hash ([0-9a-f]{32})/;

async function raHash(isoPath) {
  const { stdout } = await execFileAsync(RAHASHER_PATH, ['-v', '999', isoPath]);
  const match = stdout.match(HASH_RE);
  if (!match) {
    throw new Error(`RAHasher produced no hash for ${isoPath}:\n${stdout}`);
  }
  return match[1];
}

async function run() {
  let failures = 0;

  for (const group of GROUPS) {
    const referencePath = path.join(SAMPLES_DIR, group.referenceIso);
    const expectedHash = await raHash(referencePath);
    console.log(`${group.referenceIso}: reference RA hash = ${expectedHash}`);

    for (const rvzFile of group.rvzFiles) {
      const rvzPath = path.join(SAMPLES_DIR, rvzFile);
      const outPath = path.join(SAMPLES_DIR, `_test_${rvzFile}.iso`);
      try {
        await rvzToIso(rvzPath, outPath);
        const actualHash = await raHash(outPath);
        const pass = actualHash === expectedHash;
        console.log(`${pass ? 'PASS' : 'FAIL'} ${rvzFile}: ${actualHash}`);
        if (!pass) failures++;
      } catch (err) {
        console.log(`FAIL ${rvzFile}: ${err.message}`);
        failures++;
      } finally {
        await fs.rm(outPath, { force: true });
      }
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll RetroAchievements hash tests passed.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
