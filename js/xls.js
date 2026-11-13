// Lettore del vecchio formato Excel (.xls, BIFF8 dentro un contenitore OLE), senza dipendenze.
// Restituisce il primo foglio come righe di celle (stringhe o numeri).

const END = 0xfffffffe;

/** Estrae da un contenitore OLE ("compound file") il flusso con il nome indicato. */
function readStream(buf, names) {
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const ssz = 1 << v.getUint16(30, true);
  const mini = 1 << v.getUint16(32, true);
  const cutoff = v.getUint32(56, true);
  const sector = (n) => (n + 1) * ssz;
  const inFile = (n) => n < END - 4 && sector(n) + ssz <= buf.byteLength + ssz - 1 && sector(n) < buf.byteLength;

  // Elenco dei settori che contengono la FAT (109 nell'intestazione, gli altri in catena).
  const fatSectors = [];
  for (let i = 0; i < 109; i++) {
    const s = v.getUint32(76 + i * 4, true);
    if (inFile(s)) fatSectors.push(s);
  }
  for (let s = v.getUint32(68, true), guard = 0; inFile(s) && guard < 10000; guard++) {
    for (let i = 0; i < ssz / 4 - 1; i++) {
      const f = v.getUint32(sector(s) + i * 4, true);
      if (inFile(f)) fatSectors.push(f);
    }
    s = v.getUint32(sector(s) + ssz - 4, true);
  }
  const perSector = ssz / 4;
  const fat = (n) => {
    const fs = fatSectors[Math.floor(n / perSector)];
    return fs === undefined ? END : v.getUint32(sector(fs) + (n % perSector) * 4, true);
  };
  const chain = (start, size) => {
    const parts = [];
    let total = 0;
    for (let s = start, guard = 0; inFile(s) && guard < 1e6; s = fat(s), guard++) {
      parts.push(u8.subarray(sector(s), Math.min(sector(s) + ssz, buf.byteLength)));
      total += ssz;
      if (size !== undefined && total >= size) break;
    }
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return size !== undefined ? out.subarray(0, size) : out;
  };

  const dir = chain(v.getUint32(48, true));
  const dv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  let root = null, entry = null;
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const type = dir[o + 66];
    const len = Math.max(0, dv.getUint16(o + 64, true) - 2);
    const name = new TextDecoder('utf-16le').decode(dir.subarray(o, o + Math.min(len, 64)));
    const e = { start: dv.getUint32(o + 116, true), size: dv.getUint32(o + 120, true) };
    if (type === 5) root = e;
    else if (type === 2 && !entry && names.includes(name.toLowerCase())) entry = e;
  }
  if (!entry) return null;
  if (entry.size >= cutoff || !root) return chain(entry.start, entry.size);

  // Flussi piccoli: stanno nel "mini stream" del nodo radice, indirizzati dalla mini FAT.
  const miniStream = chain(root.start, root.size);
  const miniFat = chain(v.getUint32(60, true));
  const mv = new DataView(miniFat.buffer, miniFat.byteOffset, miniFat.byteLength);
  const out = new Uint8Array(entry.size);
  let o = 0;
  for (let s = entry.start, guard = 0; s < END - 4 && o < entry.size && guard < 1e6; guard++) {
    out.set(miniStream.subarray(s * mini, Math.min(s * mini + mini, s * mini + entry.size - o)), o);
    o += mini;
    s = s * 4 + 4 <= miniFat.length ? mv.getUint32(s * 4, true) : END;
  }
  return out;
}

const latin = new TextDecoder('windows-1252');
const wide = new TextDecoder('utf-16le');

/** Stringa BIFF8 (lunghezza a 16 bit + opzioni) dentro un singolo record. */
function inlineString(d, o, biff8) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const cch = dv.getUint16(o, true);
  if (!biff8) return latin.decode(d.subarray(o + 2, o + 2 + cch));
  const flags = d[o + 2];
  let p = o + 3;
  if (flags & 8) p += 2;
  if (flags & 4) p += 4;
  return flags & 1 ? wide.decode(d.subarray(p, p + cch * 2)) : latin.decode(d.subarray(p, p + cch));
}

/** Tabella delle stringhe condivise: può proseguire su più record CONTINUE. */
function parseSST(segs) {
  let si = 0, p = 8;
  const more = () => { while (si < segs.length && p >= segs[si].length) { si++; p = 0; } return si < segs.length; };
  const byte = () => (more() ? segs[si][p++] : 0);
  const num = (n) => { let x = 0; for (let i = 0; i < n; i++) x += byte() * 2 ** (8 * i); return x; };
  const skip = (n) => { while (n > 0 && more()) { const k = Math.min(n, segs[si].length - p); p += k; n -= k; } };
  const sv = new DataView(segs[0].buffer, segs[0].byteOffset, segs[0].byteLength);
  const count = sv.getUint32(4, true);
  const out = [];
  for (let i = 0; i < count && more(); i++) {
    let cch = num(2);
    const flags = byte();
    let hi = flags & 1;
    const runs = flags & 8 ? num(2) : 0;
    const ext = flags & 4 ? num(4) : 0;
    let s = '';
    while (cch > 0) {
      if (p >= segs[si].length) {
        // I caratteri proseguono nel record successivo, che inizia con un nuovo byte di opzioni.
        si++; p = 0;
        if (si >= segs.length) break;
        hi = segs[si][p++] & 1;
      }
      const n = Math.min(cch, Math.floor((segs[si].length - p) / (hi ? 2 : 1)));
      if (n <= 0) { p = segs[si].length; continue; }
      const bytes = segs[si].subarray(p, p + n * (hi ? 2 : 1));
      s += hi ? wide.decode(bytes) : latin.decode(bytes);
      p += bytes.length;
      cch -= n;
    }
    skip(runs * 4 + ext);
    out.push(s);
  }
  return out;
}

function rk(n) {
  let x;
  if (n & 2) x = n >> 2;
  else {
    const b = new DataView(new ArrayBuffer(8));
    b.setUint32(4, n & 0xfffffffc, true);
    x = b.getFloat64(0, true);
  }
  return n & 1 ? x / 100 : x;
}

export function readXls(buf) {
  const wb = readStream(buf, ['workbook', 'book']);
  if (!wb) throw new Error('flusso Workbook non trovato');
  const dv = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);
  const records = function* (from) {
    for (let o = from; o + 4 <= wb.length; ) {
      const id = dv.getUint16(o, true), len = dv.getUint16(o + 2, true);
      yield { id, o: o + 4, d: wb.subarray(o + 4, o + 4 + len) };
      o += 4 + len;
    }
  };

  let biff8 = true, sst = [], sheetAt = -1, depth = 0;
  let sstSegs = null;
  for (const r of records(0)) {
    if (sstSegs && r.id === 0x3c) { sstSegs.push(r.d); continue; }
    if (sstSegs) { sst = parseSST(sstSegs); sstSegs = null; }
    if (r.id === 0x0809) { if (depth++ === 0) biff8 = dv.getUint16(r.o, true) >= 0x0600; }
    else if (r.id === 0x002f) throw new Error('file protetto da password');
    else if (r.id === 0x00fc) sstSegs = [r.d];
    else if (r.id === 0x0085 && sheetAt < 0 && r.d[5] === 0) sheetAt = dv.getUint32(r.o, true);
    else if (r.id === 0x000a) break; // fine della sezione globale
  }
  if (sheetAt < 0) throw new Error('nessun foglio');

  const rows = [];
  const set = (row, col, val) => {
    if (row > 200000 || col > 1000) return;
    while (rows.length <= row) rows.push([]);
    const r = rows[row];
    while (r.length < col) r.push('');
    r[col] = typeof val === 'string' ? val.trim() : val;
  };
  let pending = null, first = true;
  for (const r of records(sheetAt)) {
    const d = r.d;
    const u16 = (o) => dv.getUint16(r.o + o, true);
    if (r.id === 0x0809) { if (!first) break; first = false; continue; }
    if (r.id === 0x000a) break;
    if (d.length < 6 && r.id !== 0x0207) continue;
    switch (r.id) {
      case 0x00fd: set(u16(0), u16(2), sst[dv.getUint32(r.o + 6, true)] ?? ''); break;
      case 0x0204: case 0x00d6: set(u16(0), u16(2), inlineString(d, 6, biff8)); break;
      case 0x0203: set(u16(0), u16(2), dv.getFloat64(r.o + 6, true)); break;
      case 0x027e: set(u16(0), u16(2), rk(dv.getUint32(r.o + 6, true))); break;
      case 0x00bd:
        for (let o = 4, c = u16(2); o + 6 <= d.length - 2; o += 6, c++) set(u16(0), c, rk(dv.getUint32(r.o + o + 2, true)));
        break;
      case 0x0006:
        if (u16(12) === 0xffff) { if (d[6] === 0) pending = [u16(0), u16(2)]; }
        else set(u16(0), u16(2), dv.getFloat64(r.o + 6, true));
        break;
      case 0x0207:
        if (pending) { set(pending[0], pending[1], inlineString(d, 0, biff8)); pending = null; }
        break;
    }
  }
  return rows;
}
