'use strict';

const lzma = require('lzma-native');

// Decode the LZMA "lc/lp/pb" properties byte, per the standard LZMA property
// encoding used by the 7-Zip SDK and documented publicly in dolphin's
// docs/WiaAndRvz.md.
function decodeLzma1Props(byte) {
  if (byte >= 9 * 5 * 5) {
    throw new Error('Invalid LZMA properties byte');
  }
  const lc = byte % 9;
  const rest = Math.floor(byte / 9);
  const pb = Math.floor(rest / 5);
  const lp = rest % 5;
  return { lc, lp, pb };
}

function decodeLzma2DictSize(propByte) {
  if (propByte > 40) {
    throw new Error('Invalid LZMA2 dictionary size property');
  }
  if (propByte === 40) return 0xffffffff;
  return (2 | (propByte & 1)) << (Math.floor(propByte / 2) + 11);
}

function runRawStream(filters, input) {
  return new Promise((resolve, reject) => {
    const stream = lzma.createStream('rawDecoder', { filters });
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    stream.end(input);
  });
}

// `comprData` is the raw wia_disc_t.compr_data (up to 7 bytes).
async function decompressLzma1(input, comprData) {
  const { lc, lp, pb } = decodeLzma1Props(comprData[0]);
  const dictSize = comprData.readUInt32LE(1);
  const filters = [{ id: lzma.FILTER_LZMA1, lc, lp, pb, dict_size: dictSize }];
  return runRawStream(filters, input);
}

async function decompressLzma2(input, comprData) {
  const dictSize = decodeLzma2DictSize(comprData[0]);
  const filters = [{ id: lzma.FILTER_LZMA2, dict_size: dictSize }];
  return runRawStream(filters, input);
}

module.exports = { decompressLzma1, decompressLzma2 };
