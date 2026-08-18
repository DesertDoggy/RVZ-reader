#!/usr/bin/env node
'use strict';

const path = require('path');
const { rvzToIso } = require('./index');

async function main() {
  const [, , input, output] = process.argv;
  if (!input) {
    console.error('Usage: rvz2iso <input.rvz|.wia> [output.iso]');
    process.exit(1);
  }
  const outPath = output || input.replace(/\.(rvz|wia)$/i, '') + '.iso';
  console.log(`Converting ${input} -> ${outPath}`);
  await rvzToIso(path.resolve(input), path.resolve(outPath));
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
