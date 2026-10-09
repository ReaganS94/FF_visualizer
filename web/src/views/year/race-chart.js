// The running totals of the Jahresrückblick, and of the story's card that compares the year with the one before.

import { MONTHS, fmtDate } from "../../lib/dates.js";
import { esc } from "../../lib/text.js";
import { DAY_SLOTS } from "../../lib/year.js";
import { niceMax } from "../../lib/count.js";
import "./race-chart.css";

// One line per year. The chosen year is coloured, the others grey, each with its total at the end.
// series: [{label, values, sel}], marks: [{i, text}] notes on the chosen line.
export function raceChart(el, series, { height = 260, hover = true, marks = [] } = {}) {
  const W = el.clientWidth || 1000, H = height, L = 34, R = 72, T = 10, B = 24;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values.filter((v) => v !== null))));
  const x = (i) => L + ((W - L - R) * i) / 365;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const f = (n) => n.toFixed(1);
  const ends = series.map((s) => { const i = s.values.findLastIndex((v) => v !== null); return { s, i, v: s.values[i] }; });
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Einsätze seit 1. Januar: ${esc(ends.map((e) => `${e.s.label} ${e.v}`).join(", "))}">`;
  const steps = max % 4 === 0 ? 4 : 5;
  for (let k = 0; k <= steps; k++) {
    const v = (max / steps) * k;
    svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${f(y(v))}" y2="${f(y(v))}"/><text x="${L - 6}" y="${f(y(v) + 4)}" text-anchor="end">${Math.round(v)}</text>`;
  }
  const narrow = W < 600;
  MONTHS.forEach((m, k) => {
    if (!narrow || k % 3 === 0) svg += `<text x="${f(x(DAY_SLOTS.indexOf(`${String(k + 1).padStart(2, "0")}-15`)))}" y="${H - 6}" text-anchor="middle">${m}</text>`;
  });
  for (const e of [...ends].sort((a, b) => a.s.sel - b.s.sel)) { // chosen year last, on top
    const pts = e.s.values.slice(0, e.i + 1).map((v, i) => `${f(x(i))},${f(y(v))}`).join(" ");
    svg += `<polyline class="race${e.s.sel ? " sel" : ""}" pathLength="1" points="${pts}"/>`;
  }
  const sel = ends.find((e) => e.s.sel);
  for (const m of marks) svg += `<text class="anno" x="${f(x(m.i) - 6)}" y="${f(y(sel.s.values[m.i]) + 4)}" text-anchor="end">${esc(m.text)}</text>`;
  if (sel) svg += `<circle class="race-dot" cx="${f(x(sel.i))}" cy="${f(y(sel.v))}" r="4"/>`;
  // Totals at the line ends. Lines reaching 31.12. share the right margin; where they end close
  // together the labels are pushed apart and a short connector leads back to the line.
  const right = ends.filter((e) => x(e.i) > W - R - 60).map((e) => ({ ...e, ly: y(e.v) + 4 })).sort((a, b) => a.ly - b.ly);
  for (let k = 1; k < right.length; k++) right[k].ly = Math.max(right[k].ly, right[k - 1].ly + 14);
  const over = right.length ? right[right.length - 1].ly - (H - B) : 0;
  if (over > 0) for (const e of right) e.ly -= over;
  for (const e of ends) {
    const r = right.find((o) => o.s === e.s);
    const cls = `end${e.s.sel ? " sel" : ""}`;
    if (!r) { svg += `<text class="${cls}" x="${f(x(e.i) + 8)}" y="${f(y(e.v) + 4)}">${esc(e.s.label)}: ${e.v}</text>`; continue; }
    if (Math.abs(r.ly - 4 - y(e.v)) > 2) svg += `<line class="leader" x1="${f(x(e.i) + 2)}" y1="${f(y(e.v))}" x2="${W - R + 5}" y2="${f(r.ly - 4)}"/>`;
    svg += `<text class="${cls}" x="${W - R + 8}" y="${f(r.ly)}">${esc(e.s.label)}: ${e.v}</text>`;
  }
  if (hover) {
    const bw = (W - L - R) / 365;
    DAY_SLOTS.forEach((d, i) => {
      const vals = ends.filter((e) => i <= e.i).sort((a, b) => b.s.label.localeCompare(a.s.label))
        .map((e) => `${e.s.label}: <b>${e.s.values[i]}</b>`).join("<br>");
      if (!vals) return;
      svg += `<g class="day"><line class="guide" x1="${f(x(i))}" x2="${f(x(i))}" y1="${T}" y2="${H - B}"/>` +
        `<rect class="hit" x="${f(x(i) - bw / 2)}" y="${T}" width="${f(bw)}" height="${H - T - B}" data-tip="${esc(`<b>${fmtDate(`2024-${d}`).slice(0, 6)}</b><br>${vals}`)}"/></g>`;
    });
  }
  el.innerHTML = svg + "</svg>" + (hover && sel && series.length > 1
    ? `<div class="legend"><i class="key sel"></i>${esc(sel.s.label)} <i class="key"></i>andere Jahre</div>` : "");
}
