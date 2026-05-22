const fs = require('fs');
const path = require('path');

const zlib = require('zlib');

function createChunk(type, data) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcVal = zlib.crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdrData = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
const idatData = zlib.deflateSync(Buffer.from([0, 0, 0, 0, 0]));
const pngData = Buffer.concat([
  pngSignature,
  createChunk('IHDR', ihdrData),
  createChunk('IDAT', idatData),
  createChunk('IEND', Buffer.alloc(0))
]);

function createDummyPng(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, pngData);
}

function createDummyIco(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // ICO Header: Reserved (2), Type (1 = ICO) (2), Count (1) (2)
  const icoHeader = Buffer.from([0, 0, 1, 0, 1, 0]);
  const size = pngData.length;
  // Entry: Width (1), Height (1), Palette (1), Reserved (1), Planes (2), Bits (2), Size (4), Offset (4 = 22)
  const entry = Buffer.alloc(16);
  entry.writeUInt8(1, 0); // Width
  entry.writeUInt8(1, 1); // Height
  entry.writeUInt8(0, 2); // Colors
  entry.writeUInt8(0, 3); // Reserved
  entry.writeUInt16LE(1, 4); // Color Planes
  entry.writeUInt16LE(32, 6); // Bits per pixel
  entry.writeUInt32LE(size, 8); // Image size
  entry.writeUInt32LE(22, 12); // Offset to image data

  fs.writeFileSync(filePath, Buffer.concat([icoHeader, entry, pngData]));
}

function createDummyIcns(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const size = pngData.length;
  const blockSize = size + 8;
  const totalSize = blockSize + 8;

  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(totalSize, 4);

  const blockHeader = Buffer.alloc(8);
  blockHeader.write('ic08', 0, 4, 'ascii');
  blockHeader.writeUInt32BE(blockSize, 4);

  fs.writeFileSync(filePath, Buffer.concat([header, blockHeader, pngData]));
}

const baseDir = path.join('tauri_app', 'src-tauri', 'icons');
createDummyPng(path.join(baseDir, '32x32.png'));
createDummyPng(path.join(baseDir, '128x128.png'));
createDummyPng(path.join(baseDir, '128x128@2x.png'));
createDummyIco(path.join(baseDir, 'icon.ico'));
createDummyIcns(path.join(baseDir, 'icon.icns'));

console.log("Successfully generated all dummy icons using Node.js!");
