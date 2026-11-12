// Logica pura (nessun accesso a DOM o storage): usata dall'app e dai test.

const pad = (n) => String(n).padStart(2, '0');

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const todayISO = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Converte "12,50", "1.234,56" o "12.5" in centesimi. NaN se non valido. */
export function parseAmount(input) {
  let s = String(input ?? '').trim().replace(/[\s€$£]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return Math.round(parseFloat(s) * 100);
}

export function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${pad(last)}` };
}

export const yearRange = (y) => ({ from: `${y}-01-01`, to: `${y}-12-31` });

export function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** Elenco dei mesi (YYYY-MM) compresi tra due mesi, estremi inclusi. */
export function monthsBetween(fromYm, toYm, max = 36) {
  const out = [];
  for (let ym = fromYm; ym <= toYm && out.length < max; ym = shiftMonth(ym, 1)) out.push(ym);
  return out;
}

// ---------- Categorie (albero tramite parentId) ----------

const byName = (a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' });

export function childMap(cats) {
  const ids = new Set(cats.map((c) => c.id));
  const m = new Map();
  for (const c of cats) {
    const k = c.parentId && ids.has(c.parentId) ? c.parentId : null;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(c);
  }
  for (const list of m.values()) list.sort(byName);
  return m;
}

/** Id della categoria e di tutte le sue sottocategorie, a qualsiasi livello. */
export function descendantIds(cats, id) {
  const m = childMap(cats);
  const out = new Set([id]);
  const stack = [id];
  while (stack.length) {
    for (const c of m.get(stack.pop()) || []) {
      if (!out.has(c.id)) {
        out.add(c.id);
        stack.push(c.id);
      }
    }
  }
  return out;
}

export function catPath(cats, id, sep = ' › ') {
  const by = new Map(cats.map((c) => [c.id, c]));
  const parts = [];
  let c = by.get(id);
  for (let guard = 0; c && guard < 50; guard++) {
    parts.unshift(c.name);
    c = by.get(c.parentId);
  }
  return parts.join(sep) || 'Senza categoria';
}

/** Albero appiattito in ordine di visita: [{ cat, depth }]. */
export function flattenTree(cats) {
  const m = childMap(cats);
  const out = [];
  const walk = (pid, depth) => {
    for (const c of m.get(pid) || []) {
      out.push({ cat: c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

// ---------- Movimenti ----------

export const isIncome = (t) => t.type === 'income';

/** Filtra movimenti (campo type) o categorie (campo kind) per tipo: 'expense' | 'income'. */
export const ofKind = (items, kind) =>
  items.filter((x) => ((x.type ?? x.kind) === 'income') === (kind === 'income'));

export const sum = (txs) => txs.reduce((s, t) => s + t.amount, 0);

export function filterTx(txs, f = {}) {
  const q = (f.q || '').trim().toLowerCase();
  return txs.filter(
    (t) =>
      (!f.from || t.date >= f.from) &&
      (!f.to || t.date <= f.to) &&
      (!f.catIds || f.catIds.has(t.categoryId)) &&
      (!f.accountId || t.accountId === f.accountId) &&
      (!q || (t.note || '').toLowerCase().includes(q) || (f.text ? f.text(t).includes(q) : false))
  );
}

/**
 * Totali per le figlie dirette di parentId (null = categorie principali).
 * Ogni figlia include le spese di tutte le sue sottocategorie.
 */
export function breakdownByCategory(txs, cats, parentId = null) {
  const m = childMap(cats);
  const rows = (m.get(parentId) || []).map((c) => {
    const ids = descendantIds(cats, c.id);
    return {
      id: c.id,
      label: c.name,
      icon: c.icon || '',
      color: c.color,
      hasChildren: (m.get(c.id) || []).length > 0,
      value: sum(txs.filter((t) => ids.has(t.categoryId))),
    };
  });
  if (parentId) {
    const parent = cats.find((c) => c.id === parentId);
    const direct = sum(txs.filter((t) => t.categoryId === parentId));
    if (direct) rows.push({ id: null, label: `${parent ? parent.name : ''} (senza sottocategoria)`, icon: '', color: parent && parent.color, value: direct });
  } else {
    const known = new Set(cats.map((c) => c.id));
    const orphan = sum(txs.filter((t) => !known.has(t.categoryId)));
    if (orphan) rows.push({ id: null, label: 'Senza categoria', icon: '', color: '#8a8a85', value: orphan });
  }
  return rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
}

export function breakdownByAccount(txs, accounts) {
  const tot = new Map();
  for (const t of txs) tot.set(t.accountId, (tot.get(t.accountId) || 0) + t.amount);
  const rows = accounts
    .filter((a) => tot.has(a.id))
    .map((a) => ({ id: a.id, label: a.name, color: a.color, type: a.type, value: tot.get(a.id) }));
  const known = new Set(accounts.map((a) => a.id));
  let orphan = 0;
  for (const [id, v] of tot) if (!known.has(id)) orphan += v;
  if (orphan) rows.push({ id: null, label: 'Conto eliminato', color: '#8a8a85', type: 'other', value: orphan });
  return rows.sort((a, b) => b.value - a.value);
}

export function monthlySeries(txs, months) {
  const tot = new Map(months.map((m) => [m, 0]));
  for (const t of txs) {
    const ym = t.date.slice(0, 7);
    if (tot.has(ym)) tot.set(ym, tot.get(ym) + t.amount);
  }
  return months.map((m) => ({ ym: m, value: tot.get(m) }));
}

// ---------- Budget ----------

export const budgetRange = (b, ym) => (b.period === 'year' ? yearRange(ym.slice(0, 4)) : monthRange(ym));

/**
 * Stato di un budget nel periodo che contiene il mese ym.
 * state: 'ok' | 'warn' (soglia di avviso raggiunta) | 'over' (limite superato)
 */
export function budgetStatus(b, txs, cats, ym) {
  const { from, to } = budgetRange(b, ym);
  const spent = sum(
    filterTx(txs, { from, to, catIds: descendantIds(cats, b.categoryId), accountId: b.accountId || null })
  );
  const pct = b.amount > 0 ? (spent / b.amount) * 100 : 0;
  const threshold = b.threshold ?? 80;
  const state = spent > b.amount ? 'over' : pct >= threshold ? 'warn' : 'ok';
  return { budget: b, spent, limit: b.amount, remaining: b.amount - spent, pct, threshold, state, from, to };
}

export function allBudgetStatus(data, ym) {
  const expenses = ofKind(data.transactions, 'expense');
  return data.budgets.map((b) => budgetStatus(b, expenses, data.categories, ym));
}

/** Budget il cui stato è peggiorato tra due fotografie (per l'avviso al salvataggio). */
export function worsened(before, after) {
  const rank = { ok: 0, warn: 1, over: 2 };
  const prev = new Map(before.map((s) => [s.budget.id, s.state]));
  return after.filter((s) => rank[s.state] > rank[prev.get(s.budget.id) ?? 'ok']);
}

// ---------- Movimenti ricorrenti ----------

export const FREQS = [
  ['week:1', 'Ogni settimana'],
  ['week:2', 'Ogni 2 settimane'],
  ['month:1', 'Ogni mese'],
  ['month:2', 'Ogni 2 mesi'],
  ['month:3', 'Ogni 3 mesi'],
  ['month:6', 'Ogni 6 mesi'],
  ['year:1', 'Ogni anno'],
];

export const freqLabel = (r) => (FREQS.find(([k]) => k === `${r.unit}:${r.every}`) || ['', 'Periodico'])[1];

const parseISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/**
 * Data successiva di una regola { unit: 'week'|'month'|'year', every, anchorDay }.
 * Per mesi e anni si mantiene il giorno del mese scelto all'inizio (anchorDay),
 * accorciato quando il mese è più breve: il 31 diventa 28/29 febbraio e poi torna 31.
 */
export function nextOccurrence(date, rule) {
  const d = parseISO(date);
  const every = Math.max(1, rule.every || 1);
  if (rule.unit === 'week') {
    d.setDate(d.getDate() + 7 * every);
    return todayISO(d);
  }
  const first = new Date(d.getFullYear(), d.getMonth() + (rule.unit === 'year' ? 12 * every : every), 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  first.setDate(Math.min(rule.anchorDay || d.getDate(), last));
  return todayISO(first);
}

/**
 * Crea i movimenti delle regole ricorrenti scaduti fino a oggi (compresi gli arretrati)
 * e sposta in avanti la prossima data di ogni regola. Restituisce i movimenti creati.
 */
export function applyRecurring(data, today = todayISO(), max = 1000) {
  const created = [];
  for (const r of data.recurring || []) {
    while (r.active !== false && r.nextDate <= today && (!r.endDate || r.nextDate <= r.endDate) && created.length < max) {
      const t = {
        id: uid(),
        createdAt: Date.now(),
        type: r.type === 'income' ? 'income' : 'expense',
        amount: r.amount,
        date: r.nextDate,
        categoryId: r.categoryId,
        accountId: r.accountId,
        note: r.note || '',
        recurringId: r.id,
      };
      data.transactions.push(t);
      created.push(t);
      r.nextDate = nextOccurrence(r.nextDate, r);
    }
  }
  return created;
}

// ---------- Import / export ----------

export function toCSV(txs, cats, accounts) {
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Data', 'Tipo', 'Importo', 'Categoria', 'Conto', 'Nota'].map(cell).join(';')];
  for (const t of [...txs].sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push(
      [
        t.date,
        isIncome(t) ? 'Entrata' : 'Uscita',
        (t.amount / 100).toFixed(2).replace('.', ','),
        catPath(cats, t.categoryId, ' > '),
        acc.get(t.accountId)?.name ?? '',
        t.note ?? '',
      ]
        .map(cell)
        .join(';')
    );
  }
  return lines.join('\r\n');
}

/** Restituisce un messaggio di errore, oppure null se il backup è valido. */
export function validateBackup(d) {
  if (!d || typeof d !== 'object') return 'Il file non contiene dati validi.';
  for (const k of ['accounts', 'categories', 'transactions', 'budgets'])
    if (!Array.isArray(d[k])) return `Nel file manca la sezione "${k}".`;
  if (d.transactions.some((t) => !Number.isFinite(t.amount) || !/^\d{4}-\d{2}-\d{2}$/.test(t.date || '')))
    return 'Il file contiene movimenti non validi.';
  if (d.recurring !== undefined && !Array.isArray(d.recurring)) return 'Il file contiene movimenti ricorrenti non validi.';
  return null;
}
