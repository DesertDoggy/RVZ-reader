'use strict';

const { RvzFile } = require('./rvzFile');

// Converts a Dolphin WIA/RVZ disc image at `inputPath` into a raw ISO/GCM
// image at `outputPath`. Supports the NONE, BZIP2, LZMA, LZMA2 and Zstandard
// compression methods, and reconstructs encrypted+hashed Wii partition data.
async function rvzToIso(inputPath, outputPath) {
  const rvz = await RvzFile.open(inputPath);
  try {
    await rvz.convertToIso(outputPath);
  } finally {
    await rvz.close();
  }
}

module.exports = { rvzToIso, RvzFile };
