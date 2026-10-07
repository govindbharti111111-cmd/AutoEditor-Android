const ALLOWED = new Set(['jpg','jpeg','png','webp']);
const DURATION_OFFSETS = [[128,240],[127,240],[127,240]];

function parseFilenameDuration(filename) {
  if (!filename) return null;
  const base = filename.trim();
  const m = base.match(/^(\d+)-(\d+)(?:[_\.\s].*)?$/);
  if (m) {
    const mins = parseInt(m[1], 10);
    const secs = parseInt(m[2], 10);
    return mins * 60 + secs;
  }
  return null;
}

function readVarint(buf, pos) {
  let value = 0n, shift = 0n, start = pos;
  while (pos < buf.length) {
    const b = buf[pos++];
    value |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) return { value, start, end: pos };
    shift += 7n;
    if (shift > 70n) throw new Error('Invalid KineMaster varint.');
  }
  throw new Error('Truncated KineMaster varint.');
}

function encodeFixedVarint(value, len) {
  value = BigInt(value);
  if (value < 0n) throw new Error('Negative varint.');
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const low = Number(value & 0x7fn);
    value >>= 7n;
    out[i] = i === len - 1 ? low : (low | 0x80);
  }
  if (value !== 0n) throw new Error('Varint does not fit original length.');
  return out;
}

function patchInnerVarintField(record, fieldNo, newValue) {
  const outerKey = readVarint(record, 0);
  const outerLen = readVarint(record, outerKey.end);
  const innerStart = outerLen.end;
  const innerEnd = innerStart + Number(outerLen.value);
  let p = innerStart;
  while (p < innerEnd) {
    const key = readVarint(record, p);
    const field = Number(key.value >> 3n);
    const wire = Number(key.value & 7n);
    p = key.end;
    if (wire === 0) {
      const val = readVarint(record, p);
      if (field === fieldNo) {
        const bytes = encodeFixedVarint(newValue, val.end - val.start);
        record.set(bytes, val.start);
        return val.value;
      }
      p = val.end;
    } else if (wire === 1) p += 8;
    else if (wire === 2) { const len = readVarint(record, p); p = len.end + Number(len.value); }
    else if (wire === 5) p += 4;
    else throw new Error('Unsupported KineMaster wire type.');
  }
}

function readInnerVarintField(record, fieldNo) {
  const outerKey = readVarint(record, 0);
  const outerLen = readVarint(record, outerKey.end);
  const innerStart = outerLen.end;
  const innerEnd = innerStart + Number(outerLen.value);
  let p = innerStart;
  while (p < innerEnd) {
    const key = readVarint(record, p);
    const field = Number(key.value >> 3n);
    const wire = Number(key.value & 7n);
    p = key.end;
    if (wire === 0) {
      const val = readVarint(record, p);
      if (field === fieldNo) return val.value;
      p = val.end;
    } else if (wire === 1) p += 8;
    else if (wire === 2) { const len = readVarint(record, p); p = len.end + Number(len.value); }
    else if (wire === 5) p += 4;
    else throw new Error('Unsupported KineMaster wire type.');
  }
  throw new Error(`Field ${fieldNo} not found.`);
}

function indexOfSubarray(master, sub) {
  for (let i = 0; i <= master.length - sub.length; i++) {
    let match = true;
    for (let j = 0; j < sub.length; j++) {
      if (master[i + j] !== sub[j]) { match = false; break; }
    }
    if (match) return i;
  }
  return -1;
}

function patchAssetReference(record, oldName, newName) {
  const oldBuf = new TextEncoder().encode(oldName);
  const newBuf = new TextEncoder().encode(newName);
  const pos = indexOfSubarray(record, oldBuf);
  if (pos >= 0) {
    record.set(newBuf, pos);
  }
}

function patchDuration(record, baseMs, durationMs, offsets) {
  const old = encodeFixedVarint(baseMs, 2);
  const val = encodeFixedVarint(durationMs, 2);
  for (const off of offsets) {
    if (off >= 0 && off + 2 <= record.length) {
      record.set(val, off);
    }
  }
}

function parseTopLevelRecords(chunk) {
  const records = []; let p = 0;
  while (p < chunk.length) {
    const start = p, key = readVarint(chunk, p); p = key.end;
    const field = Number(key.value >> 3n), wire = Number(key.value & 7n);
    if (wire === 2) {
      const len = readVarint(chunk, p); p = len.end + Number(len.value);
      if (p > chunk.length) break;
    } else if (wire === 0) { const v = readVarint(chunk, p); p = v.end; }
    else if (wire === 1) p += 8;
    else if (wire === 5) p += 4;
    records.push({ start, end: p, field, wire });
    if (field === 100) break;
  }
  return records;
}

function makeInternalName(index) {
  const prefix = String(index % 100).padStart(2, '0');
  const stamp = (20990101000000 + index).toString().padStart(14, '0');
  return `${prefix}_${stamp}.jpg`;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function concatUint8(arrays) {
  const total = arrays.reduce((acc, a) => acc + a.length, 0);
  const res = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    res.set(a, off);
    off += a.length;
  }
  return res;
}

function u16(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n & 0xffff, true);
  return b;
}
function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}
function u32BE(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
}

function makeZip(entries) {
  const local = [], central = []; let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const enc = new TextEncoder();

  for (const e of entries) {
    const name = enc.encode(e.name);
    const raw = e.data;
    const crc = crc32(raw);
    const lh = concatUint8([u32(0x04034b50), u16(20), u16(0), u16(0), u16(dosTime), u16(dosDate), u32(crc), u32(raw.length), u32(raw.length), u16(name.length), u16(0), name]);
    local.push(lh, raw);
    const ch = concatUint8([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(dosTime), u16(dosDate), u32(crc), u32(raw.length), u32(raw.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]);
    central.push(ch);
    offset += lh.length + raw.length;
  }
  const cd = concatUint8(central);
  const body = concatUint8(local);
  return concatUint8([body, cd, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(body.length), u16(0)]);
}
