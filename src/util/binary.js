'use strict';

const crypto = require('crypto');

function sha1(buffer) {
  return crypto.createHash('sha1').update(buffer).digest();
}

function readU32BE(buf, offset) {
  return buf.readUInt32BE(offset);
}

function readI32BE(buf, offset) {
  return buf.readInt32BE(offset);
}

function readU64BE(buf, offset) {
  return buf.readBigUInt64BE(offset);
}

module.exports = {
  sha1,
  readU32BE,
  readI32BE,
  readU64BE,
};
