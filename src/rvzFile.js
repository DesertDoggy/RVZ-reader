'use strict';

const fs = require('fs/promises');
const {
  CompressionType,
  DiscType,
  SECTOR_SIZE,
  SECTOR_DATA_SIZE,
  WIA_MAGIC,
  RVZ_MAGIC,
} = require('./constants');
const { decompressStream } = require('./compression');
const { decodeRvzPacking } = require('./rvzPacking');
const { decodePurge } = require('./compression/purge');
const { rebuildSectors } = require('./wiiHash');

const FILE_HEAD_SIZE = 0x48;
const DISC_T_SIZE = 0xdc;
const PART_T_SIZE = 0x30;
const RAW_DATA_T_SIZE = 0x18;

function readPartTEntry(buf) {
  const key = Buffer.from(buf.subarray(0, 16));
  const pd = [];
  for (let i = 0; i < 2; i++) {
    const o = 16 + i * 16;
    pd.push({
      firstSector: buf.readUInt32BE(o),
      nSectors: buf.readUInt32BE(o + 4),
      groupIndex: buf.readUInt32BE(o + 8),
      nGroups: buf.readUInt32BE(o + 12),
    });
  }
  return { key, pd };
}

function readRawDataTEntry(buf) {
  return {
    rawDataOff: buf.readBigUInt64BE(0),
    rawDataSize: buf.readBigUInt64BE(8),
    groupIndex: buf.readUInt32BE(16),
    nGroups: buf.readUInt32BE(20),
  };
}

class RvzFile {
  constructor(fileHandle) {
    this.fileHandle = fileHandle;
  }

  static async open(filePath) {
    const fileHandle = await fs.open(filePath, 'r');
    const rvz = new RvzFile(fileHandle);
    await rvz._readHeader();
    return rvz;
  }

  async close() {
    await this.fileHandle.close();
  }

  async _readExact(size, position) {
    const buf = Buffer.alloc(size);
    await this.fileHandle.read(buf, 0, size, position);
    return buf;
  }

  async _readHeader() {
    const head = await this._readExact(FILE_HEAD_SIZE, 0);
    const magic = head.toString('latin1', 0, 4);
    if (magic !== WIA_MAGIC && magic !== RVZ_MAGIC) {
      throw new Error(`Not a WIA/RVZ file (magic was ${JSON.stringify(magic)})`);
    }
    this.isRvz = magic === RVZ_MAGIC;
    this.discSizeField = head.readUInt32BE(0xc);
    this.isoFileSize = Number(head.readBigUInt64BE(0x24));

    const discBufLen = Math.min(Math.max(this.discSizeField, 1), DISC_T_SIZE);
    const rawDisc = await this._readExact(discBufLen, FILE_HEAD_SIZE);
    const disc = Buffer.alloc(DISC_T_SIZE);
    rawDisc.copy(disc);

    this.discType = disc.readUInt32BE(0);
    this.compression = disc.readUInt32BE(4);
    this.chunkSize = disc.readUInt32BE(12);
    this.dhead = Buffer.from(disc.subarray(0x10, 0x10 + 0x80));

    this.nPart = disc.readUInt32BE(0x90);
    this.partTSize = disc.readUInt32BE(0x94) || PART_T_SIZE;
    this.partOff = Number(disc.readBigUInt64BE(0x98));

    this.nRawData = disc.readUInt32BE(0xb4);
    this.rawDataOff = Number(disc.readBigUInt64BE(0xb8));
    this.rawDataSizeCompressed = disc.readUInt32BE(0xc0);

    this.nGroups = disc.readUInt32BE(0xc4);
    this.groupOff = Number(disc.readBigUInt64BE(0xc8));
    this.groupSizeCompressed = disc.readUInt32BE(0xd0);

    this.comprDataLen = disc.readUInt8(0xd4);
    this.comprData = Buffer.from(disc.subarray(0xd5, 0xd5 + 7));

    this.groupEntrySize = this.isRvz ? 12 : 8;

    await this._readTables();
  }

  async _decompressTable(offset, compressedSize, expectedSize) {
    const raw = await this._readExact(compressedSize, offset);
    const data = await decompressStream(this.compression, raw, this.comprData);
    return data.subarray(0, expectedSize);
  }

  async _readTables() {
    this.parts = [];
    if (this.nPart > 0) {
      // wia_part_t structs are always stored uncompressed.
      const buf = await this._readExact(this.nPart * this.partTSize, this.partOff);
      for (let i = 0; i < this.nPart; i++) {
        const entry = Buffer.alloc(PART_T_SIZE);
        buf.copy(entry, 0, i * this.partTSize, i * this.partTSize + Math.min(this.partTSize, PART_T_SIZE));
        this.parts.push(readPartTEntry(entry));
      }
    }

    this.rawData = [];
    if (this.nRawData > 0) {
      const buf = await this._decompressTable(
        this.rawDataOff,
        this.rawDataSizeCompressed,
        this.nRawData * RAW_DATA_T_SIZE
      );
      for (let i = 0; i < this.nRawData; i++) {
        this.rawData.push(readRawDataTEntry(buf.subarray(i * RAW_DATA_T_SIZE, (i + 1) * RAW_DATA_T_SIZE)));
      }
    }

    this.groups = [];
    if (this.nGroups > 0) {
      const buf = await this._decompressTable(
        this.groupOff,
        this.groupSizeCompressed,
        this.nGroups * this.groupEntrySize
      );
      for (let i = 0; i < this.nGroups; i++) {
        const o = i * this.groupEntrySize;
        const dataOff4 = buf.readUInt32BE(o);
        const dataSize = buf.readUInt32BE(o + 4);
        const rvzPackedSize = this.groupEntrySize >= 12 ? buf.readUInt32BE(o + 8) : 0;
        this.groups.push({ dataOff4, dataSize, rvzPackedSize });
      }
    }
  }

  async _decodeGroupChunk(group, { logicalSize, isPartitionData, numExceptLists, baseDiscOffset }) {
    let compressedFlag;
    let rawSize;
    if (this.isRvz) {
      rawSize = group.dataSize & 0x7fffffff;
      compressedFlag = (group.dataSize & 0x80000000) !== 0;
    } else {
      rawSize = group.dataSize;
      compressedFlag = this.compression !== CompressionType.NONE;
    }

    if (rawSize === 0) {
      return {
        payload: Buffer.alloc(logicalSize),
        exceptionLists: isPartitionData
          ? Array.from({ length: numExceptLists }, () => [])
          : null,
      };
    }

    const dataOff = group.dataOff4 * 4;
    const raw = await this._readExact(rawSize, dataOff);
    const method = compressedFlag ? this.compression : CompressionType.NONE;

    let stream;
    if (method === CompressionType.PURGE) {
      stream = raw; // except lists (uncompressed) + purge-encoded payload
    } else {
      stream = await decompressStream(method, raw, this.comprData);
    }

    let pos = 0;
    let exceptionLists = null;
    if (isPartitionData) {
      exceptionLists = [];
      for (let i = 0; i < numExceptLists; i++) {
        const n = stream.readUInt16BE(pos);
        pos += 2;
        const list = [];
        for (let j = 0; j < n; j++) {
          const off = stream.readUInt16BE(pos);
          pos += 2;
          const hash = Buffer.from(stream.subarray(pos, pos + 20));
          pos += 20;
          list.push({ offset: off, hash });
        }
        exceptionLists.push(list);
      }
      if (method === CompressionType.NONE || method === CompressionType.PURGE) {
        pos = Math.ceil(pos / 4) * 4;
      }
    }

    const payloadStream = stream.subarray(pos);
    let payload;
    if (group.rvzPackedSize > 0) {
      payload = decodeRvzPacking(payloadStream.subarray(0, group.rvzPackedSize), logicalSize, baseDiscOffset);
    } else if (method === CompressionType.PURGE) {
      payload = decodePurge(payloadStream, logicalSize);
    } else {
      payload = Buffer.from(payloadStream.subarray(0, logicalSize));
    }

    return { payload, exceptionLists };
  }

  async _decodeRun(groupIndex, nGroups, totalLogicalSize, isPartitionData, numExceptListsPerGroup, baseDiscOffset) {
    const out = Buffer.alloc(totalLogicalSize);
    let outPos = 0;
    const flatExceptions = isPartitionData ? [] : null; // { discHashOffset, hash }[]
    let sectorsSoFar = 0;

    for (let g = 0; g < nGroups; g++) {
      const remaining = totalLogicalSize - outPos;
      const logicalSize = Math.min(this.chunkSize, remaining);
      const group = this.groups[groupIndex + g];
      const { payload, exceptionLists } = await this._decodeGroupChunk(group, {
        logicalSize,
        isPartitionData,
        numExceptLists: numExceptListsPerGroup,
        baseDiscOffset: baseDiscOffset + outPos,
      });
      payload.copy(out, outPos);

      if (isPartitionData) {
        const sectorsInChunk = logicalSize / SECTOR_DATA_SIZE;
        const sectorsPerList = sectorsInChunk / numExceptListsPerGroup;
        exceptionLists.forEach((list, listIdx) => {
          const listStartSector = sectorsSoFar + listIdx * sectorsPerList;
          for (const ex of list) {
            flatExceptions.push({
              hashOffset: listStartSector * 0x400 + ex.offset,
              hash: ex.hash,
            });
          }
        });
        sectorsSoFar += sectorsInChunk;
      }

      outPos += logicalSize;
    }

    return { data: out, flatExceptions };
  }

  // Converts the whole disc image to a raw ISO/GCM buffer written to `outPath`.
  async convertToIso(outPath) {
    const out = await fs.open(outPath, 'w');
    try {
      await out.truncate(this.isoFileSize);

      // First 0x80 bytes always come from wia_disc_t.dhead, not raw_data.
      await out.write(this.dhead.subarray(0, 0x80), 0, 0x80, 0);

      for (const rd of this.rawData) {
        const off = Number(rd.rawDataOff);
        const size = Number(rd.rawDataSize);
        const { data } = await this._decodeRun(rd.groupIndex, rd.nGroups, size, false, 1, off);
        await out.write(data, 0, data.length, off);
      }

      if (this.discType === DiscType.WII) {
        for (const part of this.parts) {
          for (const pd of part.pd) {
            if (pd.nSectors === 0) continue;
            const totalDehashed = pd.nSectors * SECTOR_DATA_SIZE;
            const numExceptListsPerGroup =
              this.chunkSize >= 0x200000 ? this.chunkSize / 0x200000 : 1;
            const baseDiscOffset = pd.firstSector * SECTOR_SIZE;
            const { data, flatExceptions } = await this._decodeRun(
              pd.groupIndex,
              pd.nGroups,
              totalDehashed,
              true,
              numExceptListsPerGroup,
              baseDiscOffset
            );

            const exceptionsByGroup = {};
            const sectorsPerGroup = 64;
            for (const ex of flatExceptions) {
              const grp = Math.floor(ex.hashOffset / (sectorsPerGroup * 0x400));
              const offsetInGroup = ex.hashOffset % (sectorsPerGroup * 0x400);
              if (!exceptionsByGroup[grp]) exceptionsByGroup[grp] = [];
              exceptionsByGroup[grp].push({ offset: offsetInGroup, hash: ex.hash });
            }

            const encrypted = rebuildSectors(data, pd.nSectors, part.key, exceptionsByGroup);
            await out.write(encrypted, 0, encrypted.length, baseDiscOffset);
          }
        }
      } else {
        // GameCube discs have no partitions; raw_data covers the whole disc.
      }
    } finally {
      await out.close();
    }
  }
}

module.exports = { RvzFile };
