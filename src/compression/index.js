'use strict';

const { CompressionType } = require('../constants');
const { decompressLzma1, decompressLzma2 } = require('./lzma');
const { decompressBzip2 } = require('./bzip2');
const { decompressZstd } = require('./zstd');

// Fully decompresses one group's compressed byte stream using the disc's
// global compression method. Does not handle PURGE (which isn't a generic
// stream codec) or RVZ packing -- those are handled by the caller.
async function decompressStream(method, input, comprData) {
  switch (method) {
    case CompressionType.NONE:
      return input;
    case CompressionType.BZIP2:
      return decompressBzip2(input);
    case CompressionType.LZMA:
      return decompressLzma1(input, comprData);
    case CompressionType.LZMA2:
      return decompressLzma2(input, comprData);
    case CompressionType.ZSTD:
      return decompressZstd(input);
    default:
      throw new Error(`Unsupported compression method: ${method}`);
  }
}

module.exports = { decompressStream };
