'use strict';

const zstd = require('@mongodb-js/zstd');

async function decompressZstd(input) {
  return zstd.decompress(input);
}

module.exports = { decompressZstd };
