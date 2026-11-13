import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../js/importer.js';
import { XLSX_B64 } from './fixtures.js';

test('importi nei formati delle banche', () => {
  const cases = { '-1.234,56': -123456, '1,234.56': 123456, '12,50-': -1250, '(12,50)': -1250, '12.5': 1250, '1.234': 123400,
    '€ 3,00': 300, '−0,5': -50, '+7': 700, '1.234.567': 123456700 };
  for (const [s, v] of Object.entries(cases)) assert.equal(I.parseBankAmount(s), v, s);
  assert.equal(I.parseBankAmount(12.34), 1234);
  assert.equal(I.parseBankAmount(-54.3), -5430);
  assert.ok(Number.isNaN(I.parseBankAmount('abc')));
  assert.ok(Number.isNaN(I.parseBankAmount('')));
});

test('date nei formati delle banche', () => {
  assert.equal(I.parseBankDate('12/11/2026'), '2026-11-12');
  assert.equal(I.parseBankDate('1-2-26'), '2026-02-01');
  assert.equal(I.parseBankDate('03.11.2026'), '2026-11-03');
  assert.equal(I.parseBankDate('2026-11-03 10:00'), '2026-11-03');
  assert.equal(I.parseBankDate(46338), '2026-11-12'); // data numerica di Excel
  assert.equal(I.parseBankDate('31/02/2026'), null);
  assert.equal(I.parseBankDate('Totale'), null);
  assert.equal(I.parseBankDate(12.5), null);
});

test('CSV: separatore riconosciuto, virgolette e righe di premessa', () => {
  const csv = '﻿Estratto conto;;\r\nSaldo al 12/11/2026;1.000,00;\r\n\r\nData;Importo;Causale\r\n12/11/2026;-12,50;"POS; BAR ""ROMA"", MILANO"\r\n11/11/2026;1.850,00;Stipendio\r\nTotale;1.837,50;\r\n';
  const rows = I.parseCSV(csv);
  const det = I.detectTable(rows);
  assert.equal(det.headerIdx, 3);
  assert.deepEqual(det.map, { date: 0, inc: null, out: null, amount: 1, desc: 2 });
  const { items, skipped } = I.buildItems(rows, det.headerIdx, det.map);
  assert.deepEqual(items, [
    { date: '2026-11-12', type: 'expense', amount: 1250, desc: 'POS; BAR "ROMA", MILANO' },
    { date: '2026-11-11', type: 'income', amount: 185000, desc: 'Stipendio' },
  ]);
  assert.equal(skipped, 1); // la riga "Totale"
  // con la virgola come separatore e il punto decimale
  const r2 = I.parseCSV('Date,Description,Amount\n2026-11-12,"Coffee, bar",-2.50\n2026-11-13,Refund,10.00\n');
  const d2 = I.detectTable(r2);
  assert.deepEqual(I.buildItems(r2, d2.headerIdx, d2.map).items.map((i) => [i.type, i.amount, i.desc]), [['expense', 250, 'Coffee, bar'], ['income', 1000, 'Refund']]);
});

test('colonne Dare/Avere separate e codifica Windows', () => {
  const rows = I.parseCSV('Data contabile\tData valuta\tDare\tAvere\tDescrizione operazione\n05/11/2026\t05/11/2026\t30,00\t\tCarburante\n06/11/2026\t06/11/2026\t\t100,00\tRimborso\n');
  const det = I.detectTable(rows);
  assert.deepEqual(det.map, { date: 0, inc: 3, out: 2, amount: null, desc: 4 });
  assert.deepEqual(I.buildItems(rows, det.headerIdx, det.map).items.map((i) => [i.type, i.amount]), [['expense', 3000], ['income', 10000]]);
  assert.equal(I.decodeText(new Uint8Array([0x63, 0x61, 0x66, 0x66, 0xe8]).buffer), 'caffè'); // Windows-1252
  assert.equal(I.decodeText(new TextEncoder().encode('caffè').buffer), 'caffè'); // UTF-8
});

test('Excel .xlsx in stile Fineco', async () => {
  const buf = Uint8Array.from(Buffer.from(XLSX_B64, 'base64')).buffer;
  const rows = await I.readTable(buf);
  const det = I.detectTable(rows);
  assert.equal(det.headers[5], 'Descrizione_Completa');
  assert.deepEqual(det.map, { date: 0, inc: 2, out: 3, amount: null, desc: 5 });
  assert.deepEqual(I.buildItems(rows, det.headerIdx, det.map).items, [
    { date: '2026-11-10', type: 'expense', amount: 5430, desc: 'ESSELUNGA MILANO Carta N. *** 123 Data operazione 10/11/2026' },
    { date: '2026-11-27', type: 'income', amount: 185000, desc: 'ACME SRL & C. emolumenti novembre' },
    { date: '2026-11-03', type: 'expense', amount: 65000, desc: 'Affitto novembre' },
  ]);
});

test('file non supportati danno un messaggio chiaro', async () => {
  await assert.rejects(I.readTable(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]).buffer), I.ImportError);
  await assert.rejects(I.readTable(new TextEncoder().encode('%PDF-1.7').buffer), I.ImportError);
  const html = await I.readTable(new TextEncoder().encode('<html><table><tr><th>Data</th><th>Importo</th></tr><tr><td>01/11/2026</td><td>-5,00&nbsp;</td></tr></table>').buffer);
  assert.deepEqual(html, [['Data', 'Importo'], ['01/11/2026', '-5,00']]);
});

test('categoria suggerita: prima le regole, poi lo storico', () => {
  const categories = [{ id: 'super', kind: 'expense' }, { id: 'bar', kind: 'expense' }, { id: 'stip', kind: 'income' }, { id: 'old', kind: 'expense', archived: true }];
  const transactions = [
    { date: '2026-09-01', type: 'expense', categoryId: 'bar', note: 'POS 1234 BAR SPORT 01/09' },
    { date: '2026-10-01', type: 'expense', categoryId: 'super', note: 'Pagamento COOP 10/10' },
    { date: '2026-10-02', type: 'expense', categoryId: 'old', note: 'Vecchia cosa' },
  ];
  const rules = [{ text: 'Esselunga', categoryId: 'super' }, { text: 'acme', categoryId: 'stip' }, { text: 'vecchia', categoryId: 'old' }];
  const s = I.categorySuggester({ rules, categories, transactions });
  assert.equal(s({ type: 'expense', desc: 'ESSELUNGA MILANO' }), 'super');
  assert.equal(s({ type: 'income', desc: 'ACME SRL stipendio' }), 'stip');
  assert.equal(s({ type: 'expense', desc: 'ACME SRL acquisto' }), null); // regola di entrata, movimento di uscita
  assert.equal(s({ type: 'expense', desc: 'POS 9876 BAR SPORT 05/11' }), 'bar'); // stessa descrizione a parte i numeri
  assert.equal(s({ type: 'expense', desc: 'Vecchia cosa' }), null); // categoria archiviata
  assert.equal(s({ type: 'expense', desc: 'Mai visto' }), null);
});

test('doppioni: già importati, forse inseriti a mano, ripetizioni vere', () => {
  const it = (o = {}) => ({ date: '2026-11-12', type: 'expense', amount: 150, desc: 'Caffè', ...o });
  const existing = [
    { accountId: 'a', importKey: I.importKey(it()), date: '2026-11-12', type: 'expense', amount: 150 },
    { accountId: 'a', date: '2026-11-10', type: 'expense', amount: 3000 }, // inserito a mano
    { accountId: 'b', date: '2026-11-11', type: 'expense', amount: 999 }, // altro conto
  ];
  const items = I.markDuplicates([it(), it(), it({ date: '2026-11-10', amount: 3000, desc: 'Benzina' }), it({ date: '2026-11-11', amount: 999 })], existing, 'a');
  assert.deepEqual(items.map((i) => [i.dup, i.selected]), [['yes', false], [null, true], ['maybe', false], [null, true]]);
});
