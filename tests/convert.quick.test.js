'use strict';

const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { rvzToIso } = require('../src/index');

const execFileAsync = promisify(execFile);

const SAMPLES_DIR = path.join(__dirname, '..', 'samples');
const RAHASHER_PATH = path.join(SAMPLES_DIR, 'RAHasher.exe');

// Small, fast subset for quick iteration while debugging the Wii zstd path.
const REFERENCE_ISO = 'Wii.iso';
const RVZ_FILES = ['Wii.rvz', 'Wiizstd2M.rvz'];

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

  const referencePath = path.join(SAMPLES_DIR, REFERENCE_ISO);
  const expectedHash = await raHash(referencePath);
  console.log(`${REFERENCE_ISO}: reference RA hash = ${expectedHash}`);

  for (const rvzFile of RVZ_FILES) {
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
