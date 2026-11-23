const utf8 = new TextEncoder();
const table = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1 ? 0xEDB88320 : 0) ^ (crc >>> 1);
  return crc;
});

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (const byte of data) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function header(length, signature) {
  const view = new DataView(new ArrayBuffer(length));
  view.setUint32(0, signature, true);
  return view;
}

export function wordArchive(files) {
  const parts = [];
  const entries = [];
  let offset = 0;
  let directorySize = 0;
  for (const [name, value] of files) {
    const filename = utf8.encode(name);
    const data = typeof value === 'string' ? utf8.encode(value) : value;
    const checksum = crc32(data);
    const local = header(30, 0x04034B50);
    local.setUint16(4, 20, true); // ZIP version needed
    local.setUint16(12, 33, true); // 1 January 1980 (DOS date)
    local.setUint32(14, checksum, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, filename.length, true);

    const entry = header(46, 0x02014B50);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(14, 33, true);
    entry.setUint32(16, checksum, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, filename.length, true);
    entry.setUint32(42, offset, true);

    parts.push(local.buffer, filename, data);
    entries.push(entry.buffer, filename);
    offset += local.byteLength + filename.length + data.length;
    directorySize += entry.byteLength + filename.length;
  }

  const footer = header(22, 0x06054B50);
  footer.setUint16(8, files.length, true);
  footer.setUint16(10, files.length, true);
  footer.setUint32(12, directorySize, true);
  footer.setUint32(16, offset, true);
  return new Blob([...parts, ...entries, footer.buffer], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
