// Jahresspirale: one turn per year, one piece per day, from the inside out. Every date sits at the same
// angle in every year, so the seasons line up. A gap at the top holds the year labels.

import { WEEKDAYS, MONTHS, parseDate, isoDate, weekday, fmtDate, minDate, maxDate } from "../../lib/dates.js";
import { esc, einsaetze, weitere } from "../../lib/text.js";
import { DAY_SLOTS } from "../../lib/year.js";
import { $ } from "../../dom.js";
import { ALL, LISTED } from "../../data.js";
import { legend } from "../../components/charts.js";
import "./spiral.css";

export function renderSpiral(rows) {
  const el = $("#c-spiral");
  if (!rows.length) { el.innerHTML = ""; $("#spiral-note").textContent = ""; return; }
  const perDay = {};
  for (const r of rows) (perDay[r.date] ||= []).push(r);
  const years = [...new Set(rows.map((r) => r.date.slice(0, 4)))].sort();
  const listed = isoDate(LISTED);
  // A past year runs to 31.12.; the current one to its newest alarm (entered by hand or on the website).
  const lastYear = years.at(-1);
  const end = lastYear < String(new Date().getFullYear()) ? `${lastYear}-12-31` : maxDate(rows[0].date, minDate(listed, `${lastYear}-12-31`));
  const R0 = 96, W = 46, T = 34, GAP = 16; // inner radius, distance between turns, band width, gap in degrees
  const outer = R0 + years.length * W + T / 2;
  const C = outer + 34;
  const f = (n) => n.toFixed(1);
  const deg = (i) => GAP / 2 + ((360 - GAP) * i) / 366;
  const xy = (a, r) => { const t = ((a - 90) * Math.PI) / 180; return [C + r * Math.cos(t), C + r * Math.sin(t)]; };
  const pt = (a, r) => xy(a, r).map(f).join(",");
  const rad = (k, i) => R0 + (k + i / 366) * W;
  const step = (n) => (n === 0 ? "var(--empty)" : `var(--heat-${n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4})`);
  // With "Großlagen mitzählen" off, say so on those days instead of just showing 0.
  const hiddenBig = {};
  if (!$("#f-storm").checked) for (const r of ALL) if (r.bigDay && !r.standby) hiddenBig[r.date] = (hiddenBig[r.date] || 0) + 1;
  let s = `<svg viewBox="0 0 ${2 * C} ${2 * C}" role="img" aria-label="Einsätze pro Tag als Spirale, ${years[0]} bis ${years.at(-1)}">`;
  // month boundaries, visible between the turns
  const monthStart = (m) => DAY_SLOTS.indexOf(`${String(m + 1).padStart(2, "0")}-01`);
  MONTHS.forEach((name, m) => {
    const a = deg(monthStart(m)), mid = deg((monthStart(m) + (m === 11 ? 366 : monthStart(m + 1))) / 2);
    const [x1, y1] = xy(a, R0 - T / 2), [x2, y2] = xy(a, outer), [lx, ly] = xy(mid, outer + 16);
    s += `<line class="grid" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/><text x="${f(lx)}" y="${f(ly + 4)}" text-anchor="middle">${name}</text>`;
  });
  years.forEach((y, k) => {
    DAY_SLOTS.forEach((d, i) => {
      const date = `${y}-${d}`;
      if (d === "02-29" && new Date(Number(y), 1, 29).getMonth() !== 1) return; // no 29.02. this year
      if (date > end) return;
      const list = perDay[date] || [];
      const a0 = deg(i), a1 = deg(i + 1), r0 = rad(k, i), r1 = rad(k, i + 1);
      const fill = step(list.length);
      const tip = `<b>${WEEKDAYS[weekday(parseDate(date))]}, ${fmtDate(date)}</b> · ${einsaetze(list.length)}` +
        list.slice(0, 6).map((r) => `<br>${r.timeUnknown ? "" : `${esc(r.time)} `}${esc(r.keyword)} – ${esc(r.event)}`).join("") +
        (list.length > 6 ? `<br>… und ${weitere(list.length - 6)}` : "") +
        (hiddenBig[date] ? `<br>Großlage mit ${einsaetze(hiddenBig[date], true)}, nicht mitgezählt` : "") +
        (date > listed ? "<br>Noch nicht auf der Website" : "");
      s += `<path class="day-seg${date > listed ? " unlisted" : ""}" d="M${pt(a0, r0 + T / 2)}L${pt(a1, r1 + T / 2)}L${pt(a1, r1 - T / 2)}L${pt(a0, r0 - T / 2)}Z" ` +
        `fill="${fill}" stroke="${fill}" data-tip="${esc(tip)}"/>`;
    });
    const [yx, yy] = xy(0, rad(k, 0));
    s += `<text class="year-mark" x="${f(yx)}" y="${f(yy + 4)}" text-anchor="middle">${y}</text>`;
  });
  s += `<text x="${C}" y="${C - 4}" text-anchor="middle" class="center">${years.length > 1 ? `${years[0]}–${years.at(-1)}` : years[0]}</text>`;
  s += `<text x="${C}" y="${C + 14}" text-anchor="middle">${years.length > 1 ? "von innen nach außen" : "ein Jahr, eine Runde"}</text>`;
  el.innerHTML = s + "</svg>" + legend(["0", "1", "2", "3–4", "5+"], ["var(--empty)", "var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)"]);
  $("#spiral-note").textContent = "Jede Runde ist ein Jahr, jedes Stück ein Tag. Derselbe Tag liegt in jedem Jahr an derselben Stelle, " +
    "so stehen die Jahreszeiten übereinander. Je dunkler, desto mehr Einsätze an diesem Tag." +
    (end > listed ? ` Tage nach dem ${fmtDate(listed)} sind blasser: Die Website listet sie noch nicht, an diesen Tagen zählen nur vorläufige Einträge.` : "");
}
