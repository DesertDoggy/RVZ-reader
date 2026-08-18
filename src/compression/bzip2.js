'use strict';

const Bunzip = require('seek-bzip');

async function decompressBzip2(input, expectedSize) {
  // seek-bzip only understands full .bz2 streams (with the "BZh" header).
  // WIA/RVZ store raw bzip2 block streams without that framing, so we
  // synthesize a minimal container: "BZh" + level digit + raw block data.
  const withHeader = Buffer.concat([Buffer.from('BZh9'), input]);
  const result = Bunzip.decode(withHeader, expectedSize);
  return result;
}

module.exports = { decompressBzip2 };
