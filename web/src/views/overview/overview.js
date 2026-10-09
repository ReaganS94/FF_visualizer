// Übersicht: four numbers (alarms, average per week, share at night, the latest alarm) and the alarms per
// month. The offer to put the site on the home screen, also on Übersicht, is in app-offer.js.

import { MONTHS, parseDate, isoDate, fmtDate, minDate } from "../../lib/dates.js";
import { esc, einsaetze } from "../../lib/text.js";
import { DAY_START, NIGHT_START } from "../../lib/estimate.js";
import { $ } from "../../dom.js";
import { LISTED } from "../../data.js";
import { columnChart } from "../../components/charts.js";
import "./app-offer.js"; // the offer to put the site on the home screen sets itself up

export function renderOverview(rows) {
  const tiles = [];
  // Weekly average only over days the website covers (from 01.01. or the first alarm to its newest alarm),
  // the same rule as the story; days after that hold only hand entries so far.
  const year = $("#f-year").value, listed = isoDate(LISTED);
  const from = year ? `${year}-01-01` : rows.at(-1)?.date;
  const to = !rows.length ? "" : year && listed > `${year}-12-31` ? `${year}-12-31` : minDate(rows[0].date, listed);
  const covered = rows.filter((r) => r.date <= to).length;
  const days = rows.length && to >= from ? (parseDate(to) - parseDate(from)) / 864e5 + 1 : 0;
  const night = rows.filter((r) => !r.timeUnknown && (r.hour >= NIGHT_START || r.hour < DAY_START)).length;
  const known = rows.filter((r) => !r.timeUnknown).length;
  tiles.push(["Einsätze", rows.length, "in der Auswahl"]);
  tiles.push(["Ø pro Woche", days ? (covered / (days / 7)).toFixed(1).replace(".", ",") : "–", days && to < rows[0].date ? `bis ${fmtDate(to)}` : "über den gewählten Zeitraum"]);
  tiles.push(["Nachts", known ? Math.round((100 * night) / known) + " %" : "–", "zwischen 22 und 6 Uhr"]);
  tiles.push(["Letzter Einsatz", rows.length ? fmtDate(rows[0].date) : "–",
    rows.length ? esc(rows[0].event) + (rows[0].manual ? ' <span class="tag">vorläufig</span>' : "") : ""]);
  $("#tiles").innerHTML = tiles.map(([l, v, d]) => `<div class="tile"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join("");

  if (!rows.length) { $("#c-months").innerHTML = ""; return; }
  const counts = {};
  for (const r of rows) counts[r.date.slice(0, 7)] = (counts[r.date.slice(0, 7)] || 0) + 1;
  const first = parseDate(rows[rows.length - 1].date), last = parseDate(rows[0].date);
  const items = [];
  const narrow = $("#c-months").clientWidth < 600;
  for (let d = new Date(first.getFullYear(), first.getMonth(), 1); d <= last; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const k = isoDate(d).slice(0, 7), m = d.getMonth();
    const n = counts[k] || 0;
    const tick = narrow ? (m === 0 ? String(d.getFullYear()) : "")
      : m === 0 || items.length === 0 ? `${MONTHS[m]} ${d.getFullYear()}` : m % 3 === 0 ? MONTHS[m] : "";
    items.push({ value: n, tip: `${MONTHS[m]} ${d.getFullYear()}: <b>${einsaetze(n)}</b>`, tick });
  }
  columnChart($("#c-months"), items);
}
