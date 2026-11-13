import * as L from './logic.js';
import { load, save, defaultData, normalize, PALETTE, ACCOUNT_TYPES } from './store.js';
import { barList, columnChart, meter } from './charts.js';
import * as I from './importer.js';

let db = load();
const thisMonth = () => L.todayISO().slice(0, 7);
const ui = {
  tab: 'home',
  month: thisMonth(),
  tx: { period: 'month', from: '', to: '', type: '', cat: '', acc: '', q: '' },
  imp: null,
  rep: { mode: 'month', from: L.monthRange(thisMonth()).from, to: L.todayISO(), drill: null, acc: '', kind: 'expense' },
};

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (c) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: db.settings.currency, useGrouping: 'always' }).format(c / 100);
const fmtShort = (c) =>
  new Intl.NumberFormat('it-IT', { notation: 'compact', maximumFractionDigits: 1 }).format(c / 100);
const amountInput = (c) => (c / 100).toFixed(2).replace('.', ',');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const monthLabel = (ym, opt = { month: 'long', year: 'numeric' }) => {
  const [y, m] = ym.split('-').map(Number);
  return cap(new Date(y, m - 1, 1).toLocaleDateString('it-IT', opt));
};
const dayLabel = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return cap(new Date(y, m - 1, d).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
};
const shortDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
};
const catById = (id) => db.categories.find((c) => c.id === id);
const accById = (id) => db.accounts.find((a) => a.id === id);
const catIcon = (id) => {
  for (let c = catById(id), g = 0; c && g < 50; c = catById(c.parentId), g++) if (c.icon) return c.icon;
  return '•';
};
const txOf = (kind) => L.ofKind(db.transactions, kind);
const catsOf = (kind) => L.ofKind(db.categories, kind);
const KIND = { expense: { one: 'Uscita', many: 'Uscite' }, income: { one: 'Entrata', many: 'Entrate' } };
const signed = (c) => (c > 0 ? '+' : c < 0 ? '−' : '') + fmt(Math.abs(c));
const accIcon = (a) => (ACCOUNT_TYPES[a?.type] || ACCOUNT_TYPES.other).icon;
const STATE = {
  ok: { icon: '✓', label: 'Nei limiti' },
  warn: { icon: '⚠', label: 'Soglia di avviso raggiunta' },
  over: { icon: '⛔', label: 'Budget superato' },
};

function commit() {
  if (!save(db)) toast('Attenzione: non sono riuscito a salvare i dati su questo dispositivo.', 'over');
  render();
}

// ---------- Elementi comuni ----------

function toast(msg, kind = '') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  box.append(el);
  setTimeout(() => el.remove(), 6000);
}

function monthNav(label = monthLabel(ui.month)) {
  return `<div class="monthnav">
    <button class="iconbtn" data-act="month-prev" aria-label="Periodo precedente">‹</button>
    <strong>${esc(label)}</strong>
    <button class="iconbtn" data-act="month-next" aria-label="Periodo successivo">›</button>
    ${ui.month !== thisMonth() ? '<button class="btn small" data-act="month-today">Oggi</button>' : ''}
  </div>`;
}

function catOptions(selected, { none, exclude, kind } = {}) {
  const opts = none ? [`<option value="">${esc(none)}</option>`] : [];
  for (const { cat, depth } of L.flattenTree(kind ? catsOf(kind) : db.categories)) {
    if (exclude && exclude.has(cat.id)) continue;
    if (cat.archived && cat.id !== selected) continue;
    opts.push(
      `<option value="${cat.id}"${cat.id === selected ? ' selected' : ''}>${'\u00a0\u00a0\u00a0'.repeat(depth)}${depth ? '└ ' : ''}${esc((cat.icon ? cat.icon + ' ' : '') + cat.name)}</option>`
    );
  }
  return opts.join('');
}

function accOptions(selected, { none } = {}) {
  const opts = none ? [`<option value="">${esc(none)}</option>`] : [];
  for (const a of db.accounts) {
    if (a.archived && a.id !== selected) continue;
    opts.push(`<option value="${a.id}"${a.id === selected ? ' selected' : ''}>${esc(accIcon(a) + ' ' + a.name)}</option>`);
  }
  return opts.join('');
}

function txRow(t) {
  const c = catById(t.categoryId);
  const a = accById(t.accountId);
  return `<li><button class="txrow" data-act="tx-edit" data-id="${t.id}">
    <span class="txicon" style="background:${esc(c?.color || '#8a8a85')}22">${esc(catIcon(t.categoryId))}</span>
    <span class="txmain"><span class="txcat">${esc(L.catPath(db.categories, t.categoryId))}</span>
      <span class="txsub">${t.recurringId ? '<span title="Movimento ricorrente">🔁</span> ' : ''}${esc(a ? accIcon(a) + ' ' + a.name : 'Conto eliminato')}${t.note ? ' · ' + esc(t.note) : ''}</span></span>
    <span class="txamt${L.isIncome(t) ? ' income' : ''}">${L.isIncome(t) ? '+' : ''}${esc(fmt(t.amount))}</span>
  </button></li>`;
}

function budgetCard(s, editable = true) {
  const b = s.budget;
  const a = b.accountId ? accById(b.accountId) : null;
  const st = STATE[s.state];
  const left = s.remaining >= 0 ? `Restano ${fmt(s.remaining)}` : `Sforato di ${fmt(-s.remaining)}`;
  const tag = editable ? 'button' : 'div';
  return `<li><${tag} class="budget ${s.state}"${editable ? ` data-act="bud-edit" data-id="${b.id}"` : ''}>
    <span class="budhead"><span class="budname">${esc(L.catPath(db.categories, b.categoryId))}</span>
      <span class="badge ${s.state}">${st.icon} ${st.label}</span></span>
    ${meter(s.pct, s.threshold, s.state)}
    <span class="budfoot"><span><strong>${esc(fmt(s.spent))}</strong> di ${esc(fmt(s.limit))} (${Math.round(s.pct)}%)</span><span>${esc(left)}</span></span>
    <span class="budmeta">${b.period === 'year' ? 'Annuale' : 'Mensile'} · avviso al ${s.threshold}%${a ? ' · solo ' + esc(a.name) : ''}</span>
  </${tag}></li>`;
}

// ---------- Schede ----------

function viewHome() {
  const range = L.monthRange(ui.month);
  const all = L.filterTx(db.transactions, range);
  const txs = L.ofKind(all, 'expense');
  const total = L.sum(txs);
  const income = L.sum(L.ofKind(all, 'income'));
  const prev = L.sum(L.filterTx(txOf('expense'), L.monthRange(L.shiftMonth(ui.month, -1))));
  const diff = total - prev;
  const cmp = prev
    ? `${diff > 0 ? '▲' : diff < 0 ? '▼' : '='} ${fmt(Math.abs(diff))} (${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(Math.round((diff / prev) * 100))}%) rispetto a ${monthLabel(L.shiftMonth(ui.month, -1), { month: 'long' }).toLowerCase()}`
    : 'Nessuna uscita nel mese precedente';
  const statuses = L.allBudgetStatus(db, ui.month);
  const alerts = statuses.filter((s) => s.state !== 'ok').sort((a, b) => b.pct - a.pct);
  const recent = [...all].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);
  const upcoming = db.recurring
    .filter((r) => r.active !== false && (!r.endDate || r.nextDate <= r.endDate) && r.nextDate <= range.to)
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  return `${monthNav()}
    <section class="card hero"><span class="herolabel">Uscite del mese</span>
      <span class="heroval">${esc(fmt(total))}</span><span class="herosub">${esc(cmp)}</span>
      <div class="herosplit"><span>Entrate<strong class="income">${esc(fmt(income))}</strong></span>
        <span>Saldo del mese<strong>${esc(signed(income - total))}</strong></span></div></section>
    ${alerts.length ? `<section class="card"><h2>Avvisi budget</h2><ul class="budgets">${alerts.map((s) => budgetCard(s)).join('')}</ul></section>` : statuses.length ? `<section class="card okline">✓ Tutti i budget sono nei limiti.</section>` : ''}
    ${upcoming.length ? `<section class="card"><h2>Ricorrenti in arrivo questo mese</h2><ul class="rows">${upcoming.map(recRow).join('')}</ul></section>` : ''}
    <section class="card"><h2>Uscite per categoria</h2>${barList(L.breakdownByCategory(txs, catsOf('expense')), fmt)}</section>
    <section class="card"><h2>Uscite per conto</h2>${barList(L.breakdownByAccount(txs, db.accounts), fmt)}</section>
    <section class="card"><h2>Ultimi movimenti</h2>${recent.length ? `<ul class="txlist">${recent.map(txRow).join('')}</ul><button class="btn" data-act="tab" data-id="tx">Vedi tutto lo storico</button>` : '<p class="empty">Ancora nessun movimento in questo mese. Tocca “+” per aggiungerne uno.</p>'}</section>`;
}

function recRow(r) {
  const a = accById(r.accountId);
  const ended = r.endDate && r.nextDate > r.endDate;
  const when = r.active === false ? 'In pausa' : ended ? 'Terminata' : `Prossima: ${shortDate(r.nextDate)}`;
  return `<li><button class="rowbtn${r.active === false || ended ? ' archived' : ''}" data-act="rec-edit" data-id="${r.id}">
    <span class="txicon" style="background:${esc(catById(r.categoryId)?.color || '#8a8a85')}22">${esc(catIcon(r.categoryId))}</span>
    <span class="grow">${esc(L.catPath(db.categories, r.categoryId))}${r.note ? ' · ' + esc(r.note) : ''}
      <small>🔁 ${esc(L.freqLabel(r))} · ${esc(when)} · ${esc(a ? a.name : 'Conto eliminato')}</small></span>
    <span class="txamt${r.type === 'income' ? ' income' : ''}">${r.type === 'income' ? '+' : ''}${esc(fmt(r.amount))}</span></button></li>`;
}

function filteredTx() {
  const f = ui.tx;
  const range = f.period === 'month' ? L.monthRange(ui.month) : f.period === 'custom' ? { from: f.from, to: f.to } : {};
  return L.filterTx(f.type ? txOf(f.type) : db.transactions, {
    ...range,
    catIds: f.cat ? L.descendantIds(db.categories, f.cat) : null,
    accountId: f.acc || null,
    q: f.q,
    text: (t) => (L.catPath(db.categories, t.categoryId) + ' ' + (accById(t.accountId)?.name || '')).toLowerCase(),
  }).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
}

function txListHtml() {
  const txs = filteredTx();
  if (!txs.length) return '<p class="empty">Nessun movimento trovato con questi filtri.</p>';
  const groups = new Map();
  for (const t of txs) {
    if (!groups.has(t.date)) groups.set(t.date, []);
    groups.get(t.date).push(t);
  }
  const out = L.sum(L.ofKind(txs, 'expense'));
  const inc = L.sum(L.ofKind(txs, 'income'));
  const daySum = (list) => signed(L.sum(L.ofKind(list, 'income')) - L.sum(L.ofKind(list, 'expense')));
  return `<p class="listsum"><strong>${txs.length}</strong> ${txs.length === 1 ? 'movimento' : 'movimenti'} · uscite <strong>${esc(fmt(out))}</strong> · entrate <strong>${esc(fmt(inc))}</strong></p>
    ${[...groups].map(([d, list]) => `<h3 class="dayhead"><span>${esc(dayLabel(d))}</span><span>${esc(daySum(list))}</span></h3><ul class="txlist">${list.map(txRow).join('')}</ul>`).join('')}`;
}

function viewTx() {
  const f = ui.tx;
  return `<section class="card filters">
      <input type="search" data-f="tx.q" value="${esc(f.q)}" placeholder="Cerca per nota, categoria o conto" aria-label="Cerca">
      <div class="grid2">
        <label>Periodo<select data-f="tx.period">
          <option value="month"${f.period === 'month' ? ' selected' : ''}>Un mese</option>
          <option value="all"${f.period === 'all' ? ' selected' : ''}>Tutto</option>
          <option value="custom"${f.period === 'custom' ? ' selected' : ''}>Personalizzato</option></select></label>
        <label>Tipo<select data-f="tx.type">
          <option value="">Uscite ed entrate</option>
          <option value="expense"${f.type === 'expense' ? ' selected' : ''}>Solo uscite</option>
          <option value="income"${f.type === 'income' ? ' selected' : ''}>Solo entrate</option></select></label>
        <label>Categoria<select data-f="tx.cat">${catOptions(f.cat, { none: 'Tutte', kind: f.type || undefined })}</select></label>
        <label>Conto<select data-f="tx.acc">${accOptions(f.acc, { none: 'Tutti' })}</select></label>
      </div>
      ${f.period === 'month' ? monthNav() : ''}
      ${f.period === 'custom' ? `<div class="grid2"><label>Dal<input type="date" data-f="tx.from" value="${esc(f.from)}"></label><label>Al<input type="date" data-f="tx.to" value="${esc(f.to)}"></label></div>` : ''}
    </section>
    <section class="card"><div id="txlist">${txListHtml()}</div>
      <div class="btnrow"><button class="btn" data-act="imp-pick">Importa estratto conto</button>
        <button class="btn" data-act="export-csv-filtered">Esporta questi movimenti (CSV)</button></div></section>`;
}

function reportRange() {
  const r = ui.rep;
  if (r.mode === 'year') return L.yearRange(ui.month.slice(0, 4));
  if (r.mode === 'custom') return { from: r.from, to: r.to };
  return L.monthRange(ui.month);
}

function viewReports() {
  const r = ui.rep;
  if (r.drill && (catById(r.drill)?.kind === 'income') !== (r.kind === 'income')) r.drill = null;
  const range = reportRange();
  const drillIds = r.drill ? L.descendantIds(db.categories, r.drill) : null;
  const kind = r.kind === 'income' ? 'income' : 'expense';
  const scope = L.filterTx(txOf(kind), { catIds: drillIds, accountId: r.acc || null });
  const txs = L.filterTx(scope, range);
  const total = L.sum(txs);
  const inPeriod = L.filterTx(db.transactions, { ...range, accountId: r.acc || null });
  const totIn = L.sum(L.ofKind(inPeriod, 'income'));
  const totOut = L.sum(L.ofKind(inPeriod, 'expense'));
  const days = range.from && range.to ? Math.round((new Date(range.to) - new Date(range.from)) / 864e5) + 1 : 0;
  const biggest = txs.reduce((m, t) => (t.amount > (m?.amount ?? -1) ? t : m), null);

  let months;
  if (r.mode === 'year') months = L.monthsBetween(`${ui.month.slice(0, 4)}-01`, `${ui.month.slice(0, 4)}-12`);
  else if (r.mode === 'custom' && range.from && range.to) months = L.monthsBetween(range.from.slice(0, 7), range.to.slice(0, 7), 24);
  else months = L.monthsBetween(L.shiftMonth(ui.month, -11), ui.month);
  const series = L.monthlySeries(scope, months).map((p) => ({
    value: p.value,
    label: monthLabel(p.ym, { month: 'short' }).replace('.', '').slice(0, 3),
    title: monthLabel(p.ym),
    current: r.mode === 'month' && p.ym === ui.month,
  }));
  const avg = series.length ? L.sum(series.map((p) => ({ amount: p.value }))) / series.length : 0;

  const crumbs = [];
  for (let c = catById(r.drill), g = 0; c && g < 50; c = catById(c.parentId), g++) crumbs.unshift(c);
  const rows = L.breakdownByCategory(txs, catsOf(kind), r.drill).map((x) => ({ ...x, act: x.hasChildren ? 'rep-drill' : null }));
  const byAcc = L.breakdownByAccount(txs, db.accounts);
  const byType = new Map();
  for (const a of byAcc) byType.set(a.type, (byType.get(a.type) || 0) + a.value);
  const typeRows = [...byType]
    .map(([t, v]) => ({ label: (ACCOUNT_TYPES[t] || ACCOUNT_TYPES.other).label, icon: (ACCOUNT_TYPES[t] || ACCOUNT_TYPES.other).icon, value: v, color: 'var(--series)' }))
    .sort((a, b) => b.value - a.value);
  const navLabel = r.mode === 'year' ? ui.month.slice(0, 4) : monthLabel(ui.month);

  return `<section class="card filters">
      <div class="seg" role="group" aria-label="Periodo del resoconto">
        ${[['month', 'Mese'], ['year', 'Anno'], ['custom', 'Personalizzato']].map(([k, l]) => `<button data-act="rep-mode" data-id="${k}" class="${r.mode === k ? 'on' : ''}" aria-pressed="${r.mode === k}">${l}</button>`).join('')}
      </div>
      ${r.mode === 'custom' ? `<div class="grid2"><label>Dal<input type="date" data-f="rep.from" value="${esc(r.from)}"></label><label>Al<input type="date" data-f="rep.to" value="${esc(r.to)}"></label></div>` : monthNav(navLabel)}
      <label>Conto<select data-f="rep.acc">${accOptions(r.acc, { none: 'Tutti i conti' })}</select></label>
    </section>
    <section class="stats">
      <div class="card stat"><span>Entrate</span><strong class="income">${esc(fmt(totIn))}</strong></div>
      <div class="card stat"><span>Uscite</span><strong>${esc(fmt(totOut))}</strong></div>
      <div class="card stat"><span>Saldo del periodo</span><strong>${esc(signed(totIn - totOut))}</strong></div>
    </section>
    <div class="seg" role="group" aria-label="Dettaglio di uscite o entrate">
      ${['expense', 'income'].map((k) => `<button data-act="rep-kind" data-id="${k}" class="${kind === k ? 'on' : ''}" aria-pressed="${kind === k}">Dettaglio ${KIND[k].many.toLowerCase()}</button>`).join('')}
    </div>
    <section class="stats">
      <div class="card stat"><span>Movimenti</span><strong>${txs.length}</strong></div>
      <div class="card stat"><span>Media al giorno</span><strong>${esc(fmt(days > 0 ? Math.round(total / days) : 0))}</strong></div>
      <div class="card stat"><span>${KIND[kind].one} più alta</span><strong>${biggest ? esc(fmt(biggest.amount)) : '—'}</strong>${biggest ? `<small>${esc(L.catPath(db.categories, biggest.categoryId))}</small>` : ''}</div>
    </section>
    <section class="card"><h2>${KIND[kind].many} per mese${r.drill ? ' · ' + esc(catById(r.drill).name) : ''}</h2>
      <p class="hint">Media: ${esc(fmt(Math.round(avg)))} al mese${r.mode === 'month' ? ' negli ultimi 12 mesi' : ''}.</p>
      ${columnChart(series, fmt, fmtShort, Math.min(Math.max($('#main').clientWidth - 66, 280), 800))}
      <details><summary>Mostra i dati in tabella</summary><table class="datatable"><thead><tr><th>Mese</th><th>${KIND[kind].many}</th></tr></thead><tbody>${series.map((p) => `<tr><td>${esc(p.title)}</td><td>${esc(fmt(p.value))}</td></tr>`).join('')}</tbody></table></details>
    </section>
    <section class="card"><h2>${KIND[kind].many} per categoria</h2>
      ${crumbs.length ? `<nav class="crumbs"><button class="link" data-act="rep-drill" data-id="">Tutte</button>${crumbs.map((c, i) => ` › ${i === crumbs.length - 1 ? `<strong>${esc(c.name)}</strong>` : `<button class="link" data-act="rep-drill" data-id="${c.id}">${esc(c.name)}</button>`}`).join('')}</nav>` : '<p class="hint">Tocca una categoria per vedere le sue sottocategorie.</p>'}
      ${barList(rows, fmt)}</section>
    <section class="card"><h2>${KIND[kind].many} per conto</h2>${barList(byAcc, fmt)}</section>
    <section class="card"><h2>${KIND[kind].many} per tipo di conto</h2>${barList(typeRows, fmt)}</section>`;
}

function viewBudgets() {
  const statuses = L.allBudgetStatus(db, ui.month).sort((a, b) => b.pct - a.pct);
  return `${monthNav()}
    <section class="card"><h2>Budget</h2>
      <p class="hint">Un budget su una categoria conta anche tutte le sue sottocategorie. Ricevi un avviso quando raggiungi la soglia e quando superi il limite.</p>
      ${statuses.length ? `<ul class="budgets">${statuses.map((s) => budgetCard(s)).join('')}</ul>` : '<p class="empty">Non hai ancora impostato nessun budget.</p>'}
      <button class="btn primary" data-act="bud-new">Aggiungi budget</button></section>`;
}

function viewSettings() {
  const s = db.settings;
  const count = (ids) => db.transactions.filter((t) => ids.has(t.categoryId)).length;
  return `<section class="card"><h2>Conti e metodi di pagamento</h2>
      <ul class="rows">${db.accounts.map((a) => `<li><button class="rowbtn${a.archived ? ' archived' : ''}" data-act="acc-edit" data-id="${a.id}">
        <span class="dot" style="background:${esc(a.color)}"></span><span class="grow">${esc(accIcon(a) + ' ' + a.name)}<small>${esc((ACCOUNT_TYPES[a.type] || ACCOUNT_TYPES.other).label)}${a.archived ? ' · archiviato' : ''}</small></span><span class="chev">›</span></button></li>`).join('')}</ul>
      <button class="btn primary" data-act="acc-new">Aggiungi conto</button></section>
    <section class="card"><h2>Entrate e spese ricorrenti</h2>
      <p class="hint">Stipendio, affitto, abbonamenti: l'app li registra da sola alla data prevista, anche se non la apri per un po'.</p>
      ${db.recurring.length ? `<ul class="rows">${[...db.recurring].sort((a, b) => a.nextDate.localeCompare(b.nextDate)).map(recRow).join('')}</ul>` : '<p class="empty">Nessun movimento ricorrente.</p>'}
      <button class="btn primary" data-act="rec-new">Aggiungi ricorrente</button></section>
    ${['expense', 'income'].map((k) => `<section class="card"><h2>Categorie di ${KIND[k].one.toLowerCase()}</h2>
      <ul class="rows">${L.flattenTree(catsOf(k)).map(({ cat, depth }) => `<li class="catline" style="--depth:${depth}">
        <button class="rowbtn${cat.archived ? ' archived' : ''}" data-act="cat-edit" data-id="${cat.id}"><span class="dot" style="background:${esc(cat.color)}"></span>
          <span class="grow">${esc((cat.icon ? cat.icon + ' ' : '') + cat.name)}<small>${count(L.descendantIds(db.categories, cat.id))} movimenti${cat.archived ? ' · archiviata' : ''}</small></span></button>
        <button class="iconbtn" data-act="cat-new" data-id="${cat.id}" aria-label="Aggiungi sottocategoria a ${esc(cat.name)}" title="Aggiungi sottocategoria">＋</button></li>`).join('')}</ul>
      <button class="btn primary" data-act="cat-new-root" data-id="${k}">Aggiungi categoria di ${KIND[k].one.toLowerCase()}</button></section>`).join('')}
    <section class="card"><h2>Regole per le categorie</h2>
      <p class="hint">Quando importi un estratto conto, se la descrizione contiene il testo della regola il movimento riceve quella categoria. Senza regole, l'app riusa la categoria dell'ultimo movimento con la stessa descrizione.</p>
      ${db.rules.length ? `<ul class="rows">${db.rules.map((r) => `<li><button class="rowbtn" data-act="rule-edit" data-id="${r.id}"><span class="grow">Contiene “${esc(r.text)}”<small>→ ${esc(L.catPath(db.categories, r.categoryId))}</small></span><span class="chev">›</span></button></li>`).join('')}</ul>` : '<p class="empty">Nessuna regola.</p>'}
      <button class="btn primary" data-act="rule-new">Aggiungi regola</button></section>
    <section class="card"><h2>Preferenze</h2>
      <div class="grid3">
        <label>Valuta<select data-s="currency">${['EUR', 'USD', 'GBP', 'CHF'].map((c) => `<option${s.currency === c ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
        <label>Tema<select data-s="theme">${[['auto', 'Automatico'], ['light', 'Chiaro'], ['dark', 'Scuro']].map(([k, l]) => `<option value="${k}"${s.theme === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Soglia di avviso predefinita (%)<input type="number" min="1" max="100" data-s="defaultThreshold" value="${esc(s.defaultThreshold)}"></label>
      </div></section>
    <section class="card"><h2>Dati</h2>
      <p class="hint">I dati restano solo su questo dispositivo, nel browser. Esporta un backup ogni tanto: serve anche per passare i dati a un altro telefono o computer.</p>
      <div class="btnrow">
        <button class="btn" data-act="imp-pick">Importa estratto conto (Excel, CSV o PDF)</button>
        <button class="btn" data-act="export-json">Esporta backup</button>
        <button class="btn" data-act="import-json">Importa backup</button>
        <button class="btn" data-act="export-csv">Esporta tutto in CSV</button>
        <button class="btn danger" data-act="reset">Cancella tutti i dati</button>
      </div><input type="file" id="importfile" accept="application/json,.json" hidden></section>`;
}

// ---------- Importazione dell'estratto conto ----------

async function startImport(file) {
  try {
    const rows = await I.readTable(await file.arrayBuffer(), { readPdf: async (buf) => (await import('./pdf.js')).readPdf(buf) });
    const isPdf = /\.pdf$/i.test(file.name);
    const det = I.detectTable(rows);
    if (!det) return toast('Non trovo una tabella di movimenti in questo file.', 'over');
    ui.imp = { name: file.name, isPdf, rows, ...det, accountId: defaultAccountId(), back: ui.tab === 'imp' ? 'tx' : ui.tab };
    rebuildImport();
    ui.tab = 'imp';
    render();
    window.scrollTo(0, 0);
  } catch (e) {
    if (!(e instanceof I.ImportError)) console.error(e);
    toast(e instanceof I.ImportError ? e.message : 'Non riesco a leggere questo file. Scarica dalla banca i movimenti in formato Excel, CSV o PDF.', 'over');
  }
}

/** Ricalcola i movimenti dell'anteprima dopo un cambio di colonne. */
function rebuildImport() {
  const im = ui.imp;
  const { items, skipped } = I.buildItems(im.rows, im.headerIdx, im.map);
  const suggest = I.categorySuggester(db);
  for (const it of items) it.categoryId = suggest(it) || '';
  items.sort((a, b) => b.date.localeCompare(a.date));
  im.items = I.markDuplicates(items, db.transactions, im.accountId);
  im.skipped = skipped;
}

const unclassifiedIds = () => new Set(db.categories.filter((c) => c.name === I.UNCLASSIFIED && !c.parentId).map((c) => c.id));
const impCount = () => ui.imp.items.filter((i) => i.selected).length;
const impButtonLabel = (n) => (n === 1 ? 'Importa 1 movimento' : `Importa ${n} movimenti`);

function viewImport() {
  const im = ui.imp;
  const colSelect = (key, label) => `<label>${label}<select data-imp="map.${key}"><option value="">— nessuna —</option>${im.headers.map((h, i) => `<option value="${i}"${im.map[key] === i ? ' selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`;
  const opts = { expense: catOptions(null, { none: I.UNCLASSIFIED, kind: 'expense', exclude: unclassifiedIds() }), income: catOptions(null, { none: I.UNCLASSIFIED, kind: 'income', exclude: unclassifiedIds() }) };
  const withSel = (html, id) => (id ? html.replace(`value="${id}"`, `value="${id}" selected`) : html);
  const dups = im.items.filter((i) => i.dup).length;
  const n = impCount();
  return `<section class="card">
      <p class="hint">File: <strong>${esc(im.name)}</strong></p>
      ${im.isPdf ? '<p class="pdfwarn">⚠ Da un PDF i movimenti vengono ricostruiti dal testo della pagina, quindi il risultato è meno sicuro che da Excel o CSV. Controlla importi, segno (entrata o uscita) e numero dei movimenti prima di importare.</p>' : ''}
      <label>A quale conto appartiene questo estratto?<select data-imp="account">${accOptions(im.accountId)}</select></label>
      <details${im.items.length ? '' : ' open'}><summary>Colonne del file (riconosciute in automatico)</summary>
        <div class="grid2 mapgrid">${colSelect('date', 'Data')}${colSelect('desc', 'Descrizione')}${colSelect('amount', 'Importo (colonna unica con segno)')}<span></span>${colSelect('inc', 'Entrate')}${colSelect('out', 'Uscite')}</div>
        <p class="hint">Usa “Importo” se il file ha una sola colonna con i negativi per le uscite, oppure “Entrate” e “Uscite” se sono separate.</p></details>
    </section>
    <section class="card">
      ${im.items.length
        ? `<p class="listsum">Trovati <strong>${im.items.length}</strong> movimenti${dups ? `, di cui <strong>${dups}</strong> sembrano già presenti e non sono selezionati` : ''}.${im.skipped ? ` ${im.skipped === 1 ? 'Una riga senza data o importo è stata saltata' : `${im.skipped} righe senza data o importo sono state saltate`}.` : ''}</p>
        <div class="btnrow"><button class="btn small" data-act="imp-all">Seleziona tutti</button><button class="btn small" data-act="imp-none">Deseleziona tutti</button></div>
        <ul class="implist">${im.items.map((it, i) => `<li class="${it.dup ? 'dup' : ''}">
          <label class="impcheck"><input type="checkbox" data-imp-row="${i}"${it.selected ? ' checked' : ''} aria-label="Importa questo movimento"></label>
          <div class="impmain"><div class="imptop"><span>${esc(shortDate(it.date))}</span><span class="txamt${it.type === 'income' ? ' income' : ''}">${it.type === 'income' ? '+' : '−'}${esc(fmt(it.amount))}</span></div>
            <div class="impdesc">${esc(it.desc || '(senza descrizione)')}</div>
            ${it.dup ? `<div class="badge warn">⚠ ${it.dup === 'yes' ? 'Già importato' : 'Forse già inserito a mano'}</div>` : ''}
            <select data-imp-cat="${i}" aria-label="Categoria">${withSel(opts[it.type], it.categoryId)}</select></div></li>`).join('')}</ul>`
        : '<p class="empty">Non ho trovato movimenti con queste colonne. Apri “Colonne del file” qui sopra e indica dove sono data e importo.</p>'}
    </section>
    <div class="impbar"><button class="btn" data-act="imp-cancel">Annulla</button>
      <button class="btn primary" data-act="imp-confirm" id="impgo"${n ? '' : ' disabled'}>${impButtonLabel(n)}</button></div>`;
}

function confirmImport() {
  const im = ui.imp;
  const chosen = im.items.filter((i) => i.selected);
  if (!chosen.length) return;
  const month = thisMonth();
  const before = L.allBudgetStatus(db, month);
  const fallback = {};
  const unclassified = (kind) => {
    if (fallback[kind]) return fallback[kind];
    let c = db.categories.find((x) => x.kind === kind && !x.parentId && x.name === I.UNCLASSIFIED);
    if (!c) db.categories.push((c = { id: L.uid(), name: I.UNCLASSIFIED, icon: '❓', color: '#8a8a85', kind, parentId: null, archived: false }));
    c.archived = false;
    return (fallback[kind] = c.id);
  };
  for (const it of chosen)
    db.transactions.push({
      id: L.uid(), createdAt: Date.now(), type: it.type, amount: it.amount, date: it.date,
      categoryId: catById(it.categoryId) ? it.categoryId : unclassified(it.type),
      accountId: im.accountId, note: it.desc.slice(0, 200), importKey: I.importKey(it),
    });
  const todo = chosen.filter((it) => !catById(it.categoryId)).length;
  ui.imp = null;
  ui.tab = 'tx';
  Object.assign(ui.tx, { period: 'all', type: '', cat: '', acc: '', q: '' });
  commit();
  window.scrollTo(0, 0);
  toast(`Importati ${chosen.length} movimenti.${todo ? ` ${todo} sono in “Da classificare”: toccali per scegliere la categoria.` : ''}`);
  budgetToasts(before, month);
}

function editRule(id) {
  const r = db.rules.find((x) => x.id === id);
  openDialog(
    r ? 'Modifica regola' : 'Nuova regola',
    `<label>Se la descrizione contiene<input name="text" required maxlength="60" value="${esc(r?.text || '')}" placeholder="Es. esselunga" autocapitalize="off"></label>
     <label>Assegna la categoria<select name="categoryId" required>${catOptions(r?.categoryId, { none: 'Scegli…' })}</select></label>
     <p class="hint">Maiuscole e minuscole non contano. Una regola su una categoria di entrata vale solo per le entrate, e viceversa.</p>`,
    (f) => {
      const text = f.text.trim().toLowerCase();
      if (text.length < 2) return 'Scrivi almeno 2 caratteri.';
      if (!catById(f.categoryId)) return 'Scegli una categoria.';
      if (db.rules.some((x) => x.id !== id && x.text === text && catById(x.categoryId)?.kind === catById(f.categoryId).kind)) return 'Esiste già una regola con questo testo.';
      if (r) Object.assign(r, { text, categoryId: f.categoryId });
      else db.rules.push({ id: L.uid(), text, categoryId: f.categoryId });
      return null;
    },
    r &&
      (() => {
        db.rules = db.rules.filter((x) => x.id !== id);
        return null;
      })
  );
}

const VIEWS = { home: viewHome, tx: viewTx, rep: viewReports, bud: viewBudgets, set: viewSettings, imp: viewImport };
const TITLES = { home: 'Riepilogo', tx: 'Movimenti', rep: 'Resoconti', bud: 'Budget', set: 'Impostazioni', imp: 'Importa estratto conto' };

function render() {
  document.documentElement.dataset.theme = db.settings.theme === 'auto' ? '' : db.settings.theme;
  if (!document.documentElement.dataset.theme) delete document.documentElement.dataset.theme;
  if (ui.tab === 'imp' && !ui.imp) ui.tab = 'tx';
  document.body.classList.toggle('importing', ui.tab === 'imp');
  $('#title').textContent = TITLES[ui.tab];
  $('#main').innerHTML = VIEWS[ui.tab]();
  const alerts = L.allBudgetStatus(db, thisMonth()).filter((s) => s.state !== 'ok').length;
  for (const b of document.querySelectorAll('nav.tabs button')) {
    const on = b.dataset.id === ui.tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
    if (b.dataset.id === 'bud') b.querySelector('.count').textContent = alerts || '';
  }
}

// ---------- Finestre di modifica ----------

const dlg = $('#dlg');

function openDialog(title, body, onSubmit, onDelete) {
  dlg.innerHTML = `<form novalidate><h2>${esc(title)}</h2>${body}
    <p class="err" role="alert" hidden></p>
    <div class="dlgactions">${onDelete ? '<button type="button" class="btn danger" data-dlg="delete">Elimina</button>' : ''}<span class="grow"></span>
      <button type="button" class="btn" data-dlg="cancel">Annulla</button><button class="btn primary" type="submit">Salva</button></div></form>`;
  const form = $('form', dlg);
  const fail = (msg) => {
    if (!msg.trim()) return; // operazione annullata dall'utente
    const e = $('.err', dlg);
    e.textContent = msg;
    e.hidden = false;
  };
  form.onsubmit = (ev) => {
    ev.preventDefault();
    const err = onSubmit(Object.fromEntries(new FormData(form)));
    if (err) return fail(err);
    dlg.close();
    commit();
  };
  $('[data-dlg=cancel]', dlg).onclick = () => dlg.close();
  if (onDelete)
    $('[data-dlg=delete]', dlg).onclick = () => {
      const err = onDelete();
      if (err) return fail(err);
      dlg.close();
      commit();
    };
  dlg.showModal();
}

const colorField = (value) => `<label>Colore<input type="color" name="color" value="${esc(value)}"></label>`;

const typeSeg = (type) => `<div class="seg" role="group" aria-label="Tipo di movimento">
    ${['expense', 'income'].map((k) => `<button type="button" data-type="${k}" class="${type === k ? 'on' : ''}" aria-pressed="${type === k}">${KIND[k].one}</button>`).join('')}
  </div><input type="hidden" name="type" value="${type}">`;

/** Collega il selettore Uscita/Entrata di una finestra all'elenco delle categorie. */
function wireTypeSeg() {
  for (const b of dlg.querySelectorAll('[data-type]'))
    b.onclick = () => {
      $('[name=type]', dlg).value = b.dataset.type;
      for (const x of dlg.querySelectorAll('[data-type]')) {
        x.classList.toggle('on', x === b);
        x.setAttribute('aria-pressed', x === b);
      }
      $('[name=categoryId]', dlg).innerHTML = catOptions(null, { none: 'Scegli una categoria…', kind: b.dataset.type });
    };
}

const freqOptions = (sel, none) =>
  (none ? `<option value="">${none}</option>` : '') +
  L.FREQS.map(([k, l]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${l}</option>`).join('');

function budgetToasts(before, month) {
  for (const s of L.worsened(before, L.allBudgetStatus(db, month)))
    toast(
      s.state === 'over'
        ? `⛔ Budget superato: ${L.catPath(db.categories, s.budget.categoryId)} è a ${fmt(s.spent)} su ${fmt(s.limit)}.`
        : `⚠ Attenzione: ${L.catPath(db.categories, s.budget.categoryId)} ha raggiunto il ${Math.round(s.pct)}% del budget.`,
      s.state
    );
}

/** Registra i movimenti ricorrenti scaduti. Restituisce quanti ne ha creati. */
function runRecurring(announce = true) {
  const month = thisMonth();
  const before = L.allBudgetStatus(db, month);
  const created = L.applyRecurring(db);
  if (!created.length) return 0;
  save(db);
  if (announce) toast(created.length === 1 ? '🔁 Ho registrato 1 movimento ricorrente.' : `🔁 Ho registrato ${created.length} movimenti ricorrenti.`);
  budgetToasts(before, month);
  return created.length;
}

/** Controlli comuni a movimenti e ricorrenti. Restituisce { error } oppure i campi validati. */
function readTxFields(f) {
  const amount = L.parseAmount(f.amount);
  if (!(amount > 0)) return { error: 'Inserisci un importo valido, per esempio 12,50.' };
  const type = f.type === 'income' ? 'income' : 'expense';
  const cat = catById(f.categoryId);
  if (!cat || (cat.kind === 'income') !== (type === 'income')) return { error: 'Scegli una categoria.' };
  if (!accById(f.accountId)) return { error: 'Scegli un conto.' };
  return { type, amount, categoryId: f.categoryId, accountId: f.accountId, note: (f.note || '').trim() };
}

function defaultAccountId() {
  const last = accById(db.settings.lastAccountId);
  return last && !last.archived ? last.id : db.accounts.find((a) => !a.archived)?.id;
}

function editTx(id) {
  const t = db.transactions.find((x) => x.id === id);
  const type = t?.type === 'income' ? 'income' : 'expense';
  if (!db.accounts.some((a) => !a.archived) || !db.categories.some((c) => !c.archived))
    return toast('Servono almeno un conto e una categoria attivi: aggiungili dalle Impostazioni.', 'warn');
  openDialog(
    t ? 'Modifica movimento' : 'Nuovo movimento',
    `${typeSeg(type)}
     <label>Importo (${esc(db.settings.currency)})<input name="amount" inputmode="decimal" autocomplete="off" required value="${t ? amountInput(t.amount) : ''}" placeholder="0,00" class="big"></label>
     <div class="grid2"><label>Data<input type="date" name="date" required value="${esc(t?.date || L.todayISO())}"></label>
     <label>Conto<select name="accountId">${accOptions(t?.accountId || defaultAccountId())}</select></label></div>
     <label>Categoria<select name="categoryId" required>${catOptions(t?.categoryId, { none: 'Scegli una categoria…', kind: type })}</select></label>
     <label>Nota (facoltativa)<input name="note" maxlength="200" value="${esc(t?.note || '')}"></label>
     ${t ? (t.recurringId ? '<p class="hint">🔁 Creato da un movimento ricorrente: la modifica vale solo per questa volta.</p>' : '') : `<label>Ripeti<select name="freq">${freqOptions('', 'Non ripetere')}</select></label>`}`,
    (f) => {
      const rec = readTxFields(f);
      if (rec.error) return rec.error;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return 'Inserisci una data valida.';
      const month = f.date.slice(0, 7);
      const before = L.allBudgetStatus(db, month);
      if (t) Object.assign(t, rec, { date: f.date });
      else if (f.freq) {
        const [unit, every] = f.freq.split(':');
        db.recurring.push({ id: L.uid(), ...rec, unit, every: Number(every), nextDate: f.date, anchorDay: Number(f.date.slice(8)), endDate: null, active: true });
        if (!L.applyRecurring(db).length) toast(`🔁 Ricorrente salvato: verrà registrato dal ${shortDate(f.date)}.`);
      } else db.transactions.push({ id: L.uid(), createdAt: Date.now(), ...rec, date: f.date });
      db.settings.lastAccountId = f.accountId;
      // Avvisa solo per i budget peggiorati nel mese del movimento appena salvato.
      budgetToasts(before, month);
      return null;
    },
    t &&
      (() => {
        if (!confirm('Eliminare questo movimento?')) return ' ';
        db.transactions = db.transactions.filter((x) => x.id !== id);
        return null;
      })
  );
  wireTypeSeg();
  if (!t) $('[name=amount]', dlg).focus();
}

function editRecurring(id) {
  const r = db.recurring.find((x) => x.id === id);
  const type = r?.type === 'income' ? 'income' : 'expense';
  if (!db.accounts.some((a) => !a.archived) || !db.categories.some((c) => !c.archived))
    return toast('Servono almeno un conto e una categoria attivi: aggiungili dalle Impostazioni.', 'warn');
  openDialog(
    r ? 'Modifica ricorrente' : 'Nuovo ricorrente',
    `${typeSeg(type)}
     <label>Importo (${esc(db.settings.currency)})<input name="amount" inputmode="decimal" autocomplete="off" required value="${r ? amountInput(r.amount) : ''}" placeholder="0,00" class="big"></label>
     <label>Categoria<select name="categoryId" required>${catOptions(r?.categoryId, { none: 'Scegli una categoria…', kind: type })}</select></label>
     <div class="grid2"><label>Conto<select name="accountId">${accOptions(r?.accountId || defaultAccountId())}</select></label>
     <label>Frequenza<select name="freq">${freqOptions(r ? `${r.unit}:${r.every}` : 'month:1')}</select></label></div>
     <div class="grid2"><label>${r ? 'Prossima data' : 'Prima data'}<input type="date" name="nextDate" required value="${esc(r?.nextDate || L.todayISO())}"></label>
     <label>Fino al (facoltativo)<input type="date" name="endDate" value="${esc(r?.endDate || '')}"></label></div>
     <label>Nota (facoltativa)<input name="note" maxlength="200" value="${esc(r?.note || '')}" placeholder="Es. Netflix, affitto, stipendio"></label>
     ${r ? `<label class="check"><input type="checkbox" name="paused"${r.active === false ? ' checked' : ''}> In pausa (non registrare finché non la riattivo)</label>` : ''}
     <p class="hint">Se la data è oggi o nel passato, i movimenti arretrati vengono registrati subito.</p>`,
    (f) => {
      const rec = readTxFields(f);
      if (rec.error) return rec.error;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.nextDate)) return 'Inserisci una data valida.';
      if (f.endDate && f.endDate < f.nextDate) return 'La data di fine viene prima della prossima data.';
      const [unit, every] = f.freq.split(':');
      const fields = { ...rec, unit, every: Number(every), nextDate: f.nextDate, endDate: f.endDate || null, active: !f.paused };
      // Il giorno del mese di riferimento cambia solo se cambia la data.
      if (!r || r.nextDate !== f.nextDate) fields.anchorDay = Number(f.nextDate.slice(8));
      if (r) Object.assign(r, fields);
      else db.recurring.push({ id: L.uid(), ...fields });
      runRecurring();
      return null;
    },
    r &&
      (() => {
        if (!confirm('Eliminare questo ricorrente? I movimenti già registrati restano nello storico.')) return ' ';
        db.recurring = db.recurring.filter((x) => x.id !== id);
        return null;
      })
  );
  wireTypeSeg();
}

function editAccount(id) {
  const a = accById(id);
  openDialog(
    a ? 'Modifica conto' : 'Nuovo conto',
    `<label>Nome<input name="name" required maxlength="60" value="${esc(a?.name || '')}" placeholder="Es. Fineco in comune"></label>
     <div class="grid2"><label>Tipo<select name="type">${Object.entries(ACCOUNT_TYPES).map(([k, v]) => `<option value="${k}"${(a?.type || 'personal') === k ? ' selected' : ''}>${v.icon} ${v.label}</option>`).join('')}</select></label>
     ${colorField(a?.color || PALETTE[db.accounts.length % PALETTE.length])}</div>
     ${a ? `<label class="check"><input type="checkbox" name="archived"${a.archived ? ' checked' : ''}> Archiviato (non proposto per le nuove spese)</label>` : ''}`,
    (f) => {
      const name = f.name.trim();
      if (!name) return 'Dai un nome al conto.';
      if (db.accounts.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) return 'Esiste già un conto con questo nome.';
      const rec = { name, type: f.type, color: f.color, archived: !!f.archived };
      if (a) Object.assign(a, rec);
      else db.accounts.push({ id: L.uid(), ...rec });
      return null;
    },
    a &&
      (() => {
        const n = db.transactions.filter((t) => t.accountId === id).length;
        if (n) return `Questo conto ha ${n} movimenti e non può essere eliminato. Puoi archiviarlo per nasconderlo.`;
        if (db.recurring.some((r) => r.accountId === id)) return 'Questo conto è usato da un movimento ricorrente: modifica o elimina prima quello.';
        if (!confirm(`Eliminare il conto “${a.name}”?`)) return ' ';
        db.accounts = db.accounts.filter((x) => x.id !== id);
        db.budgets = db.budgets.filter((b) => b.accountId !== id);
        return null;
      })
  );
}

function editCategory(id, parentId, rootKind) {
  const c = catById(id);
  const parent = c ? c.parentId : parentId || null;
  const kind = (c || catById(parent))?.kind || (rootKind === 'income' ? 'income' : 'expense');
  const exclude = c ? L.descendantIds(db.categories, c.id) : null;
  openDialog(
    c ? 'Modifica categoria' : parent ? `Nuova sottocategoria di ${catById(parent)?.name}` : `Nuova categoria di ${KIND[kind].one.toLowerCase()}`,
    `<label>Nome<input name="name" required maxlength="60" value="${esc(c?.name || '')}"></label>
     <label>Dentro a<select name="parentId">${catOptions(parent, { none: '— Nessuna: categoria principale —', exclude, kind })}</select></label>
     <div class="grid2"><label>Icona (emoji, facoltativa)<input name="icon" maxlength="4" value="${esc(c?.icon || '')}" placeholder="🛒"></label>
     ${colorField(c?.color || catById(parent)?.color || PALETTE[catsOf(kind).filter((x) => !x.parentId).length % PALETTE.length])}</div>
     ${c ? `<label class="check"><input type="checkbox" name="archived"${c.archived ? ' checked' : ''}> Archiviata (non proposta per le nuove spese)</label>` : ''}`,
    (f) => {
      const name = f.name.trim();
      if (!name) return 'Dai un nome alla categoria.';
      const pid = f.parentId || null;
      if (db.categories.some((x) => x.id !== id && (x.parentId || null) === pid && x.name.toLowerCase() === name.toLowerCase()))
        return 'Esiste già una categoria con questo nome allo stesso livello.';
      const rec = { name, parentId: pid, kind, icon: f.icon.trim(), color: f.color, archived: !!f.archived };
      if (c) Object.assign(c, rec);
      else db.categories.push({ id: L.uid(), ...rec });
      return null;
    },
    c &&
      (() => {
        const ids = L.descendantIds(db.categories, id);
        const n = db.transactions.filter((t) => ids.has(t.categoryId)).length;
        if (n) return `Questa categoria (con le sue sottocategorie) ha ${n} movimenti e non può essere eliminata. Sposta i movimenti oppure archiviala.`;
        if (db.recurring.some((r) => ids.has(r.categoryId))) return 'Questa categoria è usata da un movimento ricorrente: modifica o elimina prima quello.';
        const subs = ids.size - 1;
        if (!confirm(`Eliminare “${c.name}”${subs ? ` e le sue ${subs} sottocategorie` : ''}?`)) return ' ';
        db.categories = db.categories.filter((x) => !ids.has(x.id));
        db.budgets = db.budgets.filter((b) => !ids.has(b.categoryId));
        db.rules = db.rules.filter((r) => !ids.has(r.categoryId));
        return null;
      })
  );
}

function editBudget(id) {
  const b = db.budgets.find((x) => x.id === id);
  if (!db.categories.length) return toast('Aggiungi prima una categoria dalle Impostazioni.', 'warn');
  openDialog(
    b ? 'Modifica budget' : 'Nuovo budget',
    `<label>Categoria o sottocategoria<select name="categoryId" required>${catOptions(b?.categoryId, { none: 'Scegli…', kind: 'expense' })}</select></label>
     <div class="grid2"><label>Limite (${esc(db.settings.currency)})<input name="amount" inputmode="decimal" autocomplete="off" required value="${b ? amountInput(b.amount) : ''}" placeholder="0,00"></label>
     <label>Periodo<select name="period"><option value="month"${b?.period !== 'year' ? ' selected' : ''}>Mensile</option><option value="year"${b?.period === 'year' ? ' selected' : ''}>Annuale</option></select></label></div>
     <div class="grid2"><label>Avvisami al (%)<input type="number" name="threshold" min="1" max="100" required value="${esc(b?.threshold ?? db.settings.defaultThreshold)}"></label>
     <label>Conto<select name="accountId">${accOptions(b?.accountId, { none: 'Tutti i conti' })}</select></label></div>`,
    (f) => {
      const amount = L.parseAmount(f.amount);
      if (!catById(f.categoryId)) return 'Scegli una categoria.';
      if (!(amount > 0)) return 'Inserisci un limite valido, per esempio 300.';
      const threshold = Number(f.threshold);
      if (!(threshold >= 1 && threshold <= 100)) return 'La soglia di avviso deve essere tra 1 e 100.';
      const accountId = f.accountId || null;
      if (db.budgets.some((x) => x.id !== id && x.categoryId === f.categoryId && x.period === f.period && (x.accountId || null) === accountId))
        return 'Esiste già un budget uguale per questa categoria, periodo e conto.';
      const rec = { categoryId: f.categoryId, amount, period: f.period, threshold, accountId };
      if (b) Object.assign(b, rec);
      else db.budgets.push({ id: L.uid(), ...rec });
      return null;
    },
    b &&
      (() => {
        if (!confirm('Eliminare questo budget?')) return ' ';
        db.budgets = db.budgets.filter((x) => x.id !== id);
        return null;
      })
  );
}

// ---------- Import / export ----------

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const exportCsv = (txs) =>
  download(`spese-${L.todayISO()}.csv`, '﻿' + L.toCSV(txs, db.categories, db.accounts), 'text/csv;charset=utf-8');

async function importFile(file) {
  try {
    const data = JSON.parse(await file.text());
    const err = L.validateBackup(data);
    if (err) return toast(err, 'over');
    if (!confirm(`Il backup contiene ${data.transactions.length} movimenti. Sostituire tutti i dati attuali con quelli del file?`)) return;
    db = normalize(data);
    runRecurring(false);
    commit();
    toast('Backup importato.');
  } catch {
    toast('Non riesco a leggere il file: non sembra un backup valido.', 'over');
  }
}

// ---------- Eventi ----------

const ACTIONS = {
  tab: (id) => {
    ui.tab = id;
    render();
    window.scrollTo(0, 0);
  },
  'month-prev': () => shift(-1),
  'month-next': () => shift(1),
  'month-today': () => {
    ui.month = thisMonth();
    render();
  },
  'tx-new': () => editTx(null),
  'tx-edit': editTx,
  'acc-new': () => editAccount(null),
  'acc-edit': editAccount,
  'cat-new': (id) => editCategory(null, id || null),
  'cat-new-root': (kind) => editCategory(null, null, kind),
  'rule-new': () => editRule(null),
  'rule-edit': editRule,
  'imp-pick': () => $('#bankfile').click(),
  'imp-cancel': () => {
    ui.tab = ui.imp?.back || 'tx';
    ui.imp = null;
    render();
  },
  'imp-confirm': confirmImport,
  'imp-all': () => setAllImport(true),
  'imp-none': () => setAllImport(false),
  'rec-new': () => editRecurring(null),
  'rec-edit': editRecurring,
  'rep-kind': (id) => {
    ui.rep.kind = id;
    ui.rep.drill = null;
    render();
  },
  'cat-edit': (id) => editCategory(id),
  'bud-new': () => editBudget(null),
  'bud-edit': editBudget,
  'rep-mode': (id) => {
    ui.rep.mode = id;
    render();
  },
  'rep-drill': (id) => {
    ui.rep.drill = id || null;
    render();
  },
  'export-json': () => download(`gestione-spese-backup-${L.todayISO()}.json`, JSON.stringify(db, null, 2), 'application/json'),
  'import-json': () => $('#importfile').click(),
  'export-csv': () => exportCsv(db.transactions),
  'export-csv-filtered': () => exportCsv(filteredTx()),
  reset: () => {
    if (!confirm('Cancellare tutti i movimenti, i budget, i conti e le categorie? L’operazione non si può annullare.')) return;
    db = defaultData();
    commit();
    toast('Dati cancellati: l’app è tornata alla configurazione iniziale.');
  },
};

function setAllImport(on) {
  for (const it of ui.imp.items) it.selected = on;
  render();
}

function refreshImportButton() {
  const n = impCount();
  const b = $('#impgo');
  b.textContent = impButtonLabel(n);
  b.disabled = !n;
}

function shift(n) {
  ui.month = L.shiftMonth(ui.month, ui.tab === 'rep' && ui.rep.mode === 'year' ? n * 12 : n);
  render();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && ACTIONS[el.dataset.act]) ACTIONS[el.dataset.act](el.dataset.id);
});

document.addEventListener('input', (e) => {
  if (e.target.dataset.f === 'tx.q') {
    ui.tx.q = e.target.value;
    $('#txlist').innerHTML = txListHtml();
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'importfile') {
    if (t.files[0]) importFile(t.files[0]);
    t.value = '';
  } else if (t.id === 'bankfile') {
    if (t.files[0]) startImport(t.files[0]);
    t.value = '';
  } else if (t.dataset.imp === 'account') {
    ui.imp.accountId = t.value;
    I.markDuplicates(ui.imp.items, db.transactions, t.value);
    render();
  } else if (t.dataset.imp) {
    const key = t.dataset.imp.split('.')[1];
    const m = ui.imp.map;
    m[key] = t.value === '' ? null : Number(t.value);
    // Colonna unica e colonne separate si escludono a vicenda.
    if (key === 'amount' && m.amount !== null) m.inc = m.out = null;
    if ((key === 'inc' || key === 'out') && m[key] !== null) m.amount = null;
    rebuildImport();
    render();
  } else if (t.dataset.impRow) {
    ui.imp.items[t.dataset.impRow].selected = t.checked;
    refreshImportButton();
  } else if (t.dataset.impCat) {
    // La stessa scelta vale per le altre righe con la stessa descrizione ancora senza categoria.
    const it = ui.imp.items[t.dataset.impCat];
    it.categoryId = t.value;
    const key = I.normalizeDesc(it.desc);
    if (t.value && key)
      ui.imp.items.forEach((o, i) => {
        if (o !== it && !o.categoryId && o.type === it.type && I.normalizeDesc(o.desc) === key) {
          o.categoryId = t.value;
          const sel = $(`[data-imp-cat="${i}"]`);
          if (sel) sel.value = t.value;
        }
      });
  } else if (t.dataset.f && t.dataset.f !== 'tx.q') {
    const [group, key] = t.dataset.f.split('.');
    ui[group][key] = t.value;
    if (t.dataset.f === 'tx.type') ui.tx.cat = '';
    render();
  } else if (t.dataset.s) {
    let v = t.value;
    if (t.dataset.s === 'defaultThreshold') v = Math.min(100, Math.max(1, Number(v) || 80));
    db.settings[t.dataset.s] = v;
    commit();
  }
});

// Etichetta al passaggio o al focus sulle colonne del grafico.
function showTip(e) {
  const g = e.target.closest?.('.colg');
  const wrap = e.target.closest?.('.chartwrap');
  if (!wrap) return document.querySelectorAll('.tip').forEach((t) => (t.hidden = true));
  const tip = $('.tip', wrap);
  if (!g) return (tip.hidden = true);
  tip.textContent = g.dataset.tip;
  tip.hidden = false;
  const wr = wrap.getBoundingClientRect();
  const gr = g.getBoundingClientRect();
  tip.style.left = `${Math.min(Math.max(gr.left - wr.left + gr.width / 2, 70), wr.width - 70)}px`;
}
document.addEventListener('pointerover', showTip);
document.addEventListener('focusin', showTip);
document.addEventListener('pointerdown', showTip);

runRecurring();
render();

// Se l'app resta aperta o torna in primo piano in un altro giorno, registra i ricorrenti scaduti.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !dlg.open && runRecurring()) render();
});

// Il grafico è disegnato sulla larghezza disponibile: ridisegna se cambia.
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  if (window.innerWidth === lastWidth || dlg.open) return;
  lastWidth = window.innerWidth;
  if (ui.tab === 'rep') render();
});

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
