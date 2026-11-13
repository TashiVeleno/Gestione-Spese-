import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';

const cats = [
  { id: 'casa', name: 'Casa', parentId: null, color: '#111' },
  { id: 'bollette', name: 'Bollette', parentId: 'casa' },
  { id: 'luce', name: 'Luce', parentId: 'bollette' },
  { id: 'cibo', name: 'Alimentari', parentId: null },
];
const accounts = [
  { id: 'cash', name: 'Contanti', type: 'cash' },
  { id: 'fineco', name: 'Fineco', type: 'shared' },
];
const tx = (amount, date, categoryId, accountId = 'cash', note = '') => ({ id: L.uid(), amount, date, categoryId, accountId, note });
const txs = [
  tx(5000, '2026-11-02', 'luce', 'fineco', 'bolletta "Enel"'),
  tx(2000, '2026-11-10', 'casa'),
  tx(3000, '2026-11-30', 'cibo'),
  tx(7000, '2026-10-15', 'bollette', 'fineco'),
  tx(1000, '2025-11-15', 'cibo'),
];

test('parseAmount accetta i formati italiani', () => {
  assert.equal(L.parseAmount('12,50'), 1250);
  assert.equal(L.parseAmount('1.234,56'), 123456);
  assert.equal(L.parseAmount('12.5'), 1250);
  assert.equal(L.parseAmount(' 7 € '), 700);
  assert.equal(L.parseAmount('0,1'), 10);
  assert.ok(Number.isNaN(L.parseAmount('abc')));
  assert.ok(Number.isNaN(L.parseAmount('')));
  assert.ok(Number.isNaN(L.parseAmount('-5')));
});

test('intervalli e spostamento dei mesi', () => {
  assert.deepEqual(L.monthRange('2024-02'), { from: '2024-02-01', to: '2024-02-29' });
  assert.equal(L.shiftMonth('2026-01', -1), '2025-12');
  assert.equal(L.shiftMonth('2026-12', 1), '2027-01');
  assert.deepEqual(L.monthsBetween('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
});

test('albero delle categorie', () => {
  assert.deepEqual([...L.descendantIds(cats, 'casa')].sort(), ['bollette', 'casa', 'luce']);
  assert.equal(L.catPath(cats, 'luce'), 'Casa › Bollette › Luce');
  assert.equal(L.catPath(cats, 'inesistente'), 'Senza categoria');
  assert.deepEqual(L.flattenTree(cats).map((x) => [x.cat.id, x.depth]), [['cibo', 0], ['casa', 0], ['bollette', 1], ['luce', 2]]);
});

test('una categoria con parentId ciclico non blocca i calcoli', () => {
  const loop = [{ id: 'a', name: 'A', parentId: 'b' }, { id: 'b', name: 'B', parentId: 'a' }];
  assert.equal(L.descendantIds(loop, 'a').size, 2);
  assert.ok(L.catPath(loop, 'a').length > 0);
});

test('filtri sui movimenti', () => {
  const nov = L.monthRange('2026-11');
  assert.equal(L.sum(L.filterTx(txs, nov)), 10000);
  assert.equal(L.sum(L.filterTx(txs, { ...nov, accountId: 'fineco' })), 5000);
  assert.equal(L.sum(L.filterTx(txs, { catIds: L.descendantIds(cats, 'casa') })), 14000);
  assert.equal(L.filterTx(txs, { q: 'enel' }).length, 1);
});

test('ripartizione per categoria con sottocategorie', () => {
  const nov = L.filterTx(txs, L.monthRange('2026-11'));
  assert.deepEqual(L.breakdownByCategory(nov, cats).map((r) => [r.id, r.value]), [['casa', 7000], ['cibo', 3000]]);
  const inCasa = L.breakdownByCategory(nov, cats, 'casa');
  assert.deepEqual(inCasa.map((r) => [r.id, r.value]), [['bollette', 5000], [null, 2000]]);
  const orphan = L.breakdownByCategory([tx(100, '2026-11-01', 'sparita')], cats);
  assert.equal(orphan[0].label, 'Senza categoria');
});

test('ripartizione per conto e serie mensile', () => {
  const nov = L.filterTx(txs, L.monthRange('2026-11'));
  assert.deepEqual(L.breakdownByAccount(nov, accounts).map((r) => [r.id, r.value]), [['cash', 5000], ['fineco', 5000]]);
  assert.deepEqual(L.monthlySeries(txs, ['2026-09', '2026-10', '2026-11']).map((p) => p.value), [0, 7000, 10000]);
});

test('stato dei budget: nei limiti, soglia, superato', () => {
  const b = (o) => ({ id: 'b', categoryId: 'casa', amount: 10000, period: 'month', threshold: 80, accountId: null, ...o });
  let s = L.budgetStatus(b(), txs, cats, '2026-11');
  assert.equal(s.spent, 7000);
  assert.equal(s.state, 'ok');
  assert.equal(L.budgetStatus(b({ threshold: 70 }), txs, cats, '2026-11').state, 'warn');
  assert.equal(L.budgetStatus(b({ amount: 7000 }), txs, cats, '2026-11').state, 'warn'); // esattamente al limite: non superato
  s = L.budgetStatus(b({ amount: 6999 }), txs, cats, '2026-11');
  assert.equal(s.state, 'over');
  assert.equal(s.remaining, -1);
  // budget annuale: conta tutto l'anno; filtro per conto
  assert.equal(L.budgetStatus(b({ period: 'year' }), txs, cats, '2026-11').spent, 14000);
  assert.equal(L.budgetStatus(b({ accountId: 'fineco' }), txs, cats, '2026-11').spent, 5000);
  // budget su una sottocategoria
  assert.equal(L.budgetStatus(b({ categoryId: 'bollette' }), txs, cats, '2026-11').spent, 5000);
});

test('worsened segnala solo i peggioramenti', () => {
  const st = (id, state) => ({ budget: { id }, state });
  const out = L.worsened([st('a', 'ok'), st('b', 'warn'), st('c', 'over')], [st('a', 'warn'), st('b', 'warn'), st('c', 'over'), st('d', 'over')]);
  assert.deepEqual(out.map((s) => s.budget.id), ['a', 'd']);
});

test('CSV e validazione del backup', () => {
  const csv = L.toCSV(txs, cats, accounts).split('\r\n');
  assert.equal(csv.length, 6);
  assert.equal(csv[0], '"Data";"Tipo";"Importo";"Categoria";"Conto";"Nota"');
  assert.ok(csv.includes('"2026-11-02";"Uscita";"50,00";"Casa > Bollette > Luce";"Fineco";"bolletta ""Enel"""'));
  assert.equal(L.validateBackup({ accounts, categories: cats, transactions: txs, budgets: [] }), null);
  assert.ok(L.validateBackup({ accounts }));
  assert.ok(L.validateBackup({ accounts, categories: cats, budgets: [], transactions: [{ amount: 'x', date: '2026-01-01' }] }));
  assert.ok(L.validateBackup(null));
});

test('entrate e uscite restano separate', () => {
  const mix = [...txs, { ...tx(150000, '2026-11-27', 'stipendio'), type: 'income' }];
  assert.equal(L.sum(L.ofKind(mix, 'income')), 150000);
  assert.equal(L.ofKind(mix, 'expense').length, txs.length);
  const kinds = [{ id: 'a', kind: 'income' }, { id: 'b', kind: 'expense' }, { id: 'c' }];
  assert.deepEqual(L.ofKind(kinds, 'expense').map((c) => c.id), ['b', 'c']);
  // un'entrata non consuma mai un budget, nemmeno se finisce su una categoria di spesa
  const data = { categories: cats, budgets: [{ id: 'b', categoryId: 'cibo', amount: 5000, period: 'month', threshold: 80 }],
    transactions: [tx(3000, '2026-11-30', 'cibo'), { ...tx(9000, '2026-11-30', 'cibo'), type: 'income' }] };
  assert.equal(L.allBudgetStatus(data, '2026-11')[0].spent, 3000);
  assert.ok(L.toCSV(mix, cats, accounts).includes('"Entrata";"1500,00"'));
});

test('date successive dei ricorrenti', () => {
  assert.equal(L.nextOccurrence('2026-11-12', { unit: 'week', every: 1 }), '2026-11-19');
  assert.equal(L.nextOccurrence('2026-12-25', { unit: 'week', every: 2 }), '2027-01-08');
  assert.equal(L.nextOccurrence('2026-11-12', { unit: 'month', every: 1, anchorDay: 12 }), '2026-12-12');
  assert.equal(L.nextOccurrence('2026-12-12', { unit: 'month', every: 3, anchorDay: 12 }), '2027-03-12');
  // il 31 si accorcia nei mesi brevi e poi torna 31
  assert.equal(L.nextOccurrence('2027-01-31', { unit: 'month', every: 1, anchorDay: 31 }), '2027-02-28');
  assert.equal(L.nextOccurrence('2027-02-28', { unit: 'month', every: 1, anchorDay: 31 }), '2027-03-31');
  assert.equal(L.nextOccurrence('2024-02-29', { unit: 'year', every: 1, anchorDay: 29 }), '2025-02-28');
});

test('applyRecurring registra gli arretrati una sola volta', () => {
  const rule = (o) => ({ id: 'r', type: 'expense', amount: 1299, categoryId: 'cibo', accountId: 'cash', note: 'abbonamento',
    unit: 'month', every: 1, nextDate: '2026-08-31', anchorDay: 31, endDate: null, active: true, ...o });
  const data = { transactions: [], recurring: [rule()] };
  const made = L.applyRecurring(data, '2026-11-12');
  assert.deepEqual(made.map((t) => t.date), ['2026-08-31', '2026-09-30', '2026-10-31']);
  assert.equal(data.recurring[0].nextDate, '2026-11-30');
  assert.ok(made.every((t) => t.recurringId === 'r' && t.amount === 1299 && t.type === 'expense'));
  assert.equal(L.applyRecurring(data, '2026-11-12').length, 0); // niente doppioni
  assert.equal(L.applyRecurring(data, '2026-11-30').length, 1); // scatta il giorno stesso
  // regole in pausa, future o terminate non creano nulla
  for (const o of [{ active: false }, { nextDate: '2026-12-01' }, { endDate: '2026-08-30' }])
    assert.equal(L.applyRecurring({ transactions: [], recurring: [rule(o)] }, '2026-11-12').length, 0);
  // la data di fine è inclusa
  assert.equal(L.applyRecurring({ transactions: [], recurring: [rule({ endDate: '2026-09-30' })] }, '2026-11-12').length, 2);
  // entrate
  assert.equal(L.applyRecurring({ transactions: [], recurring: [rule({ type: 'income', nextDate: '2026-11-12' })] }, '2026-11-12')[0].type, 'income');
});
