// Grafici in HTML/SVG senza dipendenze. Restituiscono stringhe di markup.

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Elenco di barre orizzontali con etichetta e valore sempre visibili.
 * items: [{ label, value, color, icon, act, id }]
 */
export function barList(items, fmt, { total } = {}) {
  if (!items.length) return '<p class="empty">Nessuna spesa nel periodo.</p>';
  const max = Math.max(...items.map((i) => i.value));
  const tot = total ?? items.reduce((s, i) => s + i.value, 0);
  return `<ul class="barlist">${items
    .map((i) => {
      const pct = tot ? Math.round((i.value / tot) * 100) : 0;
      const tag = i.act ? 'button' : 'div';
      const attrs = i.act ? ` type="button" data-act="${i.act}" data-id="${esc(i.id)}"` : '';
      return `<li><${tag} class="barrow"${attrs} title="${esc(i.label)}: ${esc(fmt(i.value))} (${pct}%)">
        <span class="barlabel"><span class="dot" style="background:${esc(i.color || 'var(--series)')}"></span>${i.icon ? esc(i.icon) + ' ' : ''}${esc(i.label)}${i.act ? ' <span class="chev">›</span>' : ''}</span>
        <span class="barvalue">${esc(fmt(i.value))} <small>${pct}%</small></span>
        <span class="bartrack"><span class="barfill" style="width:${max ? Math.max((i.value / max) * 100, 1) : 0}%;background:${esc(i.color || 'var(--series)')}"></span></span>
      </${tag}></li>`;
    })
    .join('')}</ul>`;
}

const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const k of [1, 2, 2.5, 5, 10]) if (v <= k * p) return k * p;
  return 10 * p;
};

/**
 * Istogramma a colonne per l'andamento nel tempo (una sola serie).
 * points: [{ label, value, title, current }] ; values in centesimi.
 */
export function columnChart(points, fmt, fmtShort, W = 640) {
  const H = 220, L = 46, R = 8, T = 12, B = 26;
  const max = niceMax(Math.max(...points.map((p) => p.value), 0));
  const iw = W - L - R, ih = H - T - B;
  const step = iw / points.length;
  const bw = Math.min(step - 2, 36);
  const y = (v) => T + ih - (v / max) * ih;
  const every = Math.ceil(points.length / 12);
  const grid = [0, 0.5, 1]
    .map((f) => {
      const yy = y(max * f);
      return `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="grid"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end" class="axis">${esc(fmtShort(max * f))}</text>`;
    })
    .join('');
  const bars = points
    .map((p, i) => {
      const x = L + i * step + (step - bw) / 2;
      const h = (p.value / max) * ih;
      const r = Math.min(4, h, bw / 2);
      const top = T + ih - h;
      const path = h > 0 ? `<path d="M${x},${T + ih} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${T + ih} Z" class="col${p.current ? ' cur' : ''}"/>` : '';
      const lab = i % every === 0 ? `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" class="axis${p.current ? ' curlab' : ''}">${esc(p.label)}</text>` : '';
      return `<g class="colg" tabindex="0" data-tip="${esc(p.title)}: ${esc(fmt(p.value))}"><rect x="${L + i * step}" y="${T}" width="${step}" height="${ih}" fill="transparent"/>${path}${lab}</g>`;
    })
    .join('');
  return `<div class="chartwrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Andamento delle spese per mese" class="colchart" width="${W}" height="${H}">${grid}${bars}</svg><div class="tip" hidden></div></div>`;
}

/** Barra di avanzamento di un budget, con tacca sulla soglia di avviso. */
export function meter(pct, threshold, state) {
  return `<span class="meter ${state}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(pct, 100))}">
    <span class="meterfill" style="width:${Math.min(pct, 100)}%"></span>
    <span class="metermark" style="left:${Math.min(threshold, 100)}%"></span>
  </span>`;
}
