'use strict';

const Bunzip = require('seek-bzip');

async function decompressBzip2(input, expectedSize) {
  // WIA/RVZ store full standard bzip2 streams (including the "BZh" header),
  // so no extra framing needs to be synthesized here.
  return Bunzip.decode(input, expectedSize);
}

module.exports = { decompressBzip2 };
