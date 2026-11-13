// Lettura degli estratti conto esportati dalla banca (CSV, Excel .xlsx e .xls, tabelle HTML, PDF).
// Nessun accesso alla pagina: tutto qui è usato anche dai test.

import { readXls } from './xls.js';

// ---------- File → tabella (righe di celle) ----------

export function decodeText(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return new TextDecoder('windows-1252').decode(b); // tipico dei CSV salvati da Excel
  }
}

function splitCSV(text, delim) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell.trim() === '') { cell = ''; quoted = true; }
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** CSV con separatore riconosciuto da solo (; , tab |): vince quello che dà più righe con lo stesso numero di colonne. */
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const sample = text.slice(0, 20000);
  let best = ';', bestScore = -1;
  for (const d of [';', '\t', ',', '|']) {
    const counts = new Map();
    for (const r of splitCSV(sample, d).slice(0, 60)) if (r.length > 1) counts.set(r.length, (counts.get(r.length) || 0) + 1);
    const score = Math.max(0, ...counts.values());
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return splitCSV(text, best).map((r) => r.map((c) => c.trim()));
}

const unxml = (s) =>
  s.replace(/&(lt|gt|quot|apos|amp|#x?[0-9a-fA-F]+);/g, (m, e) =>
    e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : e === 'apos' ? "'" : e === 'amp' ? '&'
      : String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));

/** Estrae i file di un archivio zip (un .xlsx è uno zip di file XML). */
async function unzip(buf) {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--)
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip non valido');
  const files = new Map();
  let p = v.getUint32(eocd + 16, true);
  for (let n = v.getUint16(eocd + 10, true); n > 0 && v.getUint32(p, true) === 0x02014b50; n--) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    files.set(name, { method, data: new Uint8Array(buf, start, size) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return async (name) => {
    const f = files.get(name) ?? [...files].find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
    if (!f) return null;
    if (f.method === 0) return new TextDecoder().decode(f.data);
    const stream = new Blob([f.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  };
}

/** Primo foglio di un file .xlsx come righe di celle (stringhe o numeri). */
export async function readXlsx(buf) {
  const read = await unzip(buf);
  const shared = [];
  const sst = await read('xl/sharedStrings.xml');
  if (sst)
    for (const m of sst.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g))
      shared.push(unxml([...m[1].replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '').matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((t) => t[1]).join('')));
  let sheet = await read('xl/worksheets/sheet1.xml');
  for (let i = 2; !sheet && i < 20; i++) sheet = await read(`xl/worksheets/sheet${i}.xml`);
  if (!sheet) throw new Error('nessun foglio');
  const rows = [];
  for (const rm of sheet.matchAll(/<(?:\w+:)?row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const row = [];
    for (const cm of (rm[1] || '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const ref = /\br="([A-Z]+)\d+"/.exec(cm[1]);
      let col = row.length;
      if (ref) col = [...ref[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const type = /\bt="(\w+)"/.exec(cm[1])?.[1];
      const body = cm[2] || '';
      const raw = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body)?.[1];
      let val = '';
      if (type === 'inlineStr') val = unxml([...body.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((t) => t[1]).join(''));
      else if (raw === undefined) val = '';
      else if (type === 's') val = shared[Number(raw)] ?? '';
      else if (type === 'str' || type === 'b' || type === 'e') val = unxml(raw);
      else val = Number.isFinite(Number(raw)) && raw.trim() !== '' ? Number(raw) : unxml(raw);
      while (row.length < col) row.push('');
      row[col] = typeof val === 'string' ? val.trim() : val;
    }
    rows.push(row);
  }
  return rows;
}

function parseHtmlTable(html) {
  const rows = [];
  for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))
    rows.push([...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => unxml(c[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')).replace(/\s+/g, ' ').trim()));
  return rows;
}

export class ImportError extends Error {}

// ---------- PDF ----------

const DATE_TOKEN = /^\d{1,2}[/.\-]\d{1,2}[/.\-](\d{4}|\d{2})$/;
const MONEY_TOKEN = /^[+\-−]?(\d{1,3}(\.\d{3})+|\d+),\d{2}[+\-−]?$/;
const PDF_OUT = /^(uscit|addebit|dare|debit)/, PDF_IN = /^(entrat|accredit|avere|credit)/, PDF_AMOUNT = /^(importo|ammontare|amount)/, PDF_BALANCE = /^saldo/;

/**
 * Ricostruisce la tabella dei movimenti dal testo di un PDF.
 * pages: per ogni pagina, i frammenti di testo { str, x, y, w } con y che cresce verso il basso.
 * Un movimento è una riga che inizia con una data; le righe successive senza data né importi
 * ne completano la descrizione. Gli importi sono attribuiti a Uscite/Entrate in base alla colonna
 * dell'intestazione a cui sono allineati; quelli sotto "Saldo" vengono ignorati.
 */
export function tableFromPdf(pages) {
  const out = [['Data', 'Uscite', 'Entrate', 'Importo', 'Descrizione']];
  let cols = null; // posizione delle colonne di importo, dall'ultima intestazione vista
  let last = null, lastY = 0, lastH = 10;
  for (const items of pages) {
    // Frammenti → parole con posizione stimata → righe.
    const words = [];
    for (const it of items) {
      const str = String(it.str ?? '');
      if (!str.trim()) continue;
      const per = str.length ? (it.w || 0) / str.length : 0;
      for (const m of str.matchAll(/\S+/g)) words.push({ t: m[0], x: it.x + m.index * per, r: it.x + (m.index + m[0].length) * per, y: it.y, h: it.h || 10 });
    }
    words.sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const w of words) {
      const l = lines[lines.length - 1];
      if (l && Math.abs(w.y - l.y) <= Math.max(2, w.h * 0.35)) l.words.push(w);
      else lines.push({ y: w.y, h: w.h, words: [w] });
    }
    last = null;
    for (const line of lines) {
      const ws = line.words.sort((a, b) => a.x - b.x);
      const low = ws.map((w) => norm(w.t));
      // Intestazione della tabella: ricorda dove sono le colonne degli importi.
      const heads = ws.map((w, i) => ({ w, kind: PDF_OUT.test(low[i]) ? 'out' : PDF_IN.test(low[i]) ? 'inc' : PDF_AMOUNT.test(low[i]) ? 'amount' : PDF_BALANCE.test(low[i]) ? 'balance' : null })).filter((h) => h.kind);
      if (heads.length && low.some((t) => /^(data|date)$/.test(t)) && !ws.some((w) => MONEY_TOKEN.test(w.t))) {
        cols = heads.map((h) => ({ kind: h.kind, c: (h.w.x + h.w.r) / 2, r: h.w.r }));
        last = null;
        continue;
      }
      const isDate = (w) => DATE_TOKEN.test(w.t) && parseBankDate(w.t);
      const money = ws.filter((w) => MONEY_TOKEN.test(w.t));
      if (ws.length && isDate(ws[0])) {
        const row = [ws[0].t, '', '', '', ''];
        const used = new Set(money);
        let n = 0;
        for (const m of money) {
          let kind = 'amount';
          if (cols) {
            // Colonna più vicina: gli importi sono di solito allineati a destra sotto l'intestazione.
            const near = cols.reduce((a, b) => (Math.min(Math.abs(m.r - b.r), Math.abs((m.x + m.r) / 2 - b.c)) < Math.min(Math.abs(m.r - a.r), Math.abs((m.x + m.r) / 2 - a.c)) ? b : a));
            kind = near.kind;
          } else if (n++ > 0) kind = 'balance'; // senza intestazione vale il primo importo; gli altri sono saldi
          const idx = { out: 1, inc: 2, amount: 3 }[kind];
          if (idx && !row[idx]) row[idx] = m.t;
        }
        let i = 1;
        while (i < ws.length && isDate(ws[i])) i++; // data valuta e simili
        row[4] = ws.slice(i).filter((w) => !used.has(w)).map((w) => w.t).join(' ');
        if (row[1] || row[2] || row[3]) { out.push(row); last = row; } else last = null;
        lastY = line.y; lastH = line.h;
      } else if (last && !money.length && line.y - lastY < lastH * 2.2 && ws.length) {
        last[4] = (last[4] + ' ' + ws.map((w) => w.t).join(' ')).trim();
        lastY = line.y;
      } else last = null;
    }
  }
  // Tiene solo le colonne di importo davvero usate, così il riconoscimento delle colonne non si confonde.
  const keep = [0, 1, 2, 3, 4].filter((c) => c === 0 || c === 4 || out.some((r, i) => i > 0 && r[c]));
  return out.map((r) => keep.map((c) => r[c]));
}

/**
 * Legge un file della banca e restituisce la tabella grezza.
 * readPdf(buf) deve restituire i frammenti di testo delle pagine (vedi tableFromPdf): nel browser lo fornisce js/pdf.js.
 */
export async function readTable(buf, { readPdf } = {}) {
  const b = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
  if (b[0] === 0x50 && b[1] === 0x4b) {
    try {
      return await readXlsx(buf);
    } catch {
      throw new ImportError('Non riesco a leggere questo file Excel. Prova a salvarlo come CSV.');
    }
  }
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
    try {
      return readXls(buf);
    } catch (e) {
      throw new ImportError(/password/.test(e.message) ? 'Questo file Excel è protetto da password: toglila e riprova.' : 'Non riesco a leggere questo file Excel (.xls). Prova a salvarlo come .xlsx o CSV.');
    }
  }
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) {
    if (!readPdf) throw new ImportError('La lettura dei PDF non è disponibile.');
    let pages;
    try {
      pages = await readPdf(buf);
    } catch (e) {
      throw new ImportError(/password/i.test(e?.name + ' ' + e?.message) ? 'Questo PDF è protetto da password: salvane una copia senza password e riprova.' : 'Non riesco ad aprire questo PDF.');
    }
    if (!pages.some((p) => p.length)) throw new ImportError('Questo PDF non contiene testo: sembra una scansione o una foto, e non si può leggere. Scarica dalla banca il PDF originale oppure il file Excel o CSV.');
    const table = tableFromPdf(pages);
    if (table.length < 2) throw new ImportError('Non ho trovato movimenti in questo PDF. Se la banca lo permette, scarica i movimenti in formato Excel o CSV.');
    return table;
  }
  const text = decodeText(buf);
  return /<table\b/i.test(text) ? parseHtmlTable(text) : parseCSV(text);
}

// ---------- Tabella → movimenti ----------

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
const HEADER_WORDS = /data|date|importo|amount|entrat|uscit|descrizione|description|causale|dare|avere|accredit|addebit|valuta|dettagl|operazione/;

/**
 * Trova la riga di intestazione (le banche mettono righe di premessa sopra la tabella)
 * e propone quali colonne contengono data, importo e descrizione.
 */
export function detectTable(rows) {
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const cells = rows[i].map(norm).filter(Boolean);
    if (cells.length >= 2 && cells.filter((c) => c.length < 40 && HEADER_WORDS.test(c)).length >= 2) { headerIdx = i; break; }
  }
  if (headerIdx < 0) headerIdx = rows.findIndex((r) => r.filter((c) => String(c).trim() !== '').length >= 3);
  if (headerIdx < 0) return null;
  const headers = rows[headerIdx].map((h, i) => String(h).trim() || `Colonna ${i + 1}`);
  const h = rows[headerIdx].map(norm);
  const find = (...tests) => {
    for (const t of tests) {
      const i = h.findIndex((c) => c && t.test(c));
      if (i >= 0) return i;
    }
    return null;
  };
  const map = {
    date: find(/data.*(operazione|contabile|registrazione|movimento)/, /^(data|date)$/, /^(?!.*valuta).*(data|date)/, /data|date/),
    inc: find(/entrat|accredit|avere|^credit/),
    out: find(/uscit|addebit|dare|^debit/),
    amount: find(/importo|amount|ammontare/),
    desc: find(/descrizione.*(completa|estesa)/, /descrizione|description|causale|dettagl|motivo/),
  };
  if (map.inc !== null && map.out !== null) map.amount = null;
  else if (map.amount !== null) map.inc = map.out = null;
  return { headerIdx, headers, map };
}

/** Importo della banca in centesimi con segno: accetta "-1.234,56", "1,234.56", "12,50-", "(12,50)" e numeri. */
export function parseBankAmount(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : NaN;
  let s = String(v ?? '').replace(/[−–]/g, '-').replace(/[^\d.,()+-]/g, '');
  if (!/\d/.test(s)) return NaN;
  const neg = s.includes('-') || /^\(.*\)$/.test(s);
  s = s.replace(/[()+-]/g, '');
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  let dec = -1;
  if (lastDot >= 0 && lastComma >= 0) dec = Math.max(lastDot, lastComma);
  else if (lastComma >= 0) dec = s.indexOf(',') === lastComma ? lastComma : -1; // una sola virgola: decimali (uso italiano)
  else if (lastDot >= 0) dec = s.indexOf('.') === lastDot && s.length - lastDot - 1 <= 2 ? lastDot : -1;
  const digits = dec >= 0 ? s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1) : s.replace(/[.,]/g, '');
  const n = Math.round(parseFloat(digits) * 100);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

const pad = (n) => String(n).padStart(2, '0');

/** Data della banca in formato YYYY-MM-DD: accetta gg/mm/aaaa, gg-mm-aa, aaaa-mm-gg e le date numeriche di Excel. */
export function parseBankDate(v) {
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v ?? '').trim();
  let y, m, d, x;
  if ((x = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s))) [y, m, d] = [+x[1], +x[2], +x[3]];
  else if ((x = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/.exec(s))) [d, m, y] = [+x[1], +x[2], x[3].length === 2 ? 2000 + +x[3] : +x[3]];
  else return null;
  if (m < 1 || m > 12 || d < 1 || d > new Date(y, m, 0).getDate() || y < 1990 || y > 2100) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Righe sotto l'intestazione → movimenti { date, type, amount, desc }. Le righe senza data o importo vengono saltate. */
export function buildItems(rows, headerIdx, map) {
  const items = [];
  let skipped = 0;
  const cell = (r, i) => (i === null || i === undefined ? '' : r[i] ?? '');
  for (const r of rows.slice(headerIdx + 1)) {
    if (!r.some((c) => String(c).trim() !== '')) continue;
    const date = parseBankDate(cell(r, map.date));
    let signed = NaN;
    if (map.amount !== null && map.amount !== undefined) signed = parseBankAmount(cell(r, map.amount));
    else {
      const out = parseBankAmount(cell(r, map.out)), inc = parseBankAmount(cell(r, map.inc));
      if (out) signed = -Math.abs(out);
      else if (inc) signed = Math.abs(inc);
    }
    if (!date || !signed) { skipped++; continue; }
    items.push({
      date,
      type: signed < 0 ? 'expense' : 'income',
      amount: Math.abs(signed),
      desc: String(cell(r, map.desc)).replace(/\s+/g, ' ').trim(),
    });
  }
  return { items, skipped };
}

// ---------- Categorie automatiche e doppioni ----------

/** Descrizione senza numeri, date e punteggiatura: due pagamenti allo stesso negozio danno lo stesso testo. */
export const normalizeDesc = (s) =>
  String(s ?? '').toLowerCase().replace(/[^\p{L}]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** Nome della categoria in cui finiscono i movimenti importati senza categoria. */
export const UNCLASSIFIED = 'Da classificare';

export const importKey = (it) => `${it.date}|${it.type}|${it.amount}|${it.desc.toLowerCase()}`;

/**
 * Prepara un "suggeritore" di categoria: prima le regole dell'utente ("se contiene…"),
 * poi la categoria dell'ultimo movimento registrato con la stessa descrizione.
 */
export function categorySuggester({ rules = [], categories, transactions }) {
  const kindOf = new Map(categories.map((c) => [c.id, c.kind === 'income' ? 'income' : 'expense']));
  const usable = new Set(categories.filter((c) => !c.archived && c.name !== UNCLASSIFIED).map((c) => c.id));
  const active = rules.map((r) => ({ text: String(r.text || '').toLowerCase().trim(), categoryId: r.categoryId })).filter((r) => r.text && usable.has(r.categoryId));
  const history = new Map();
  for (const t of [...transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    const k = normalizeDesc(t.note);
    if (k.length >= 4 && usable.has(t.categoryId)) history.set(`${t.type === 'income' ? 'income' : 'expense'}|${k}`, t.categoryId);
  }
  return (item) => {
    const d = item.desc.toLowerCase();
    const rule = active.find((r) => d.includes(r.text) && kindOf.get(r.categoryId) === item.type);
    return rule ? rule.categoryId : history.get(`${item.type}|${normalizeDesc(item.desc)}`) || null;
  };
}

/**
 * Segna i movimenti già presenti sul conto: dup = 'yes' se già importati (stessa data, importo e descrizione),
 * 'maybe' se esiste un movimento inserito a mano con stessa data e importo. Conta le ripetizioni:
 * due caffè identici nello stesso giorno non vengono scambiati per un doppione.
 */
export function markDuplicates(items, transactions, accountId) {
  const exact = new Map(), loose = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const t of transactions) {
    if (t.accountId !== accountId) continue;
    if (t.importKey) bump(exact, t.importKey);
    else bump(loose, `${t.date}|${t.type === 'income' ? 'income' : 'expense'}|${t.amount}`);
  }
  const take = (m, k) => (m.get(k) > 0 ? (m.set(k, m.get(k) - 1), true) : false);
  for (const it of items) {
    it.dup = take(exact, importKey(it)) ? 'yes' : take(loose, `${it.date}|${it.type}|${it.amount}`) ? 'maybe' : null;
    it.selected = !it.dup;
  }
  return items;
}
