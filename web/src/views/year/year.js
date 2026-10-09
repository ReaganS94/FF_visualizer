// Jahresrückblick: a year's numbers, its running total next to the other years, its months, alarm types and
// notable alarms. What a year counts and compares with is worked out in lib/year.js; this draws the view.
// The story of the year is in story.js.

import { MONTHS, fmtDate } from "../../lib/dates.js";
import { esc, einsaetze } from "../../lib/text.js";
import { DAY_START, NIGHT_START } from "../../lib/estimate.js";
import { NOTABLE, yearInfo, DAY_SLOTS, runningTotal } from "../../lib/year.js";
import { topCounts } from "../../lib/count.js";
import { $ } from "../../dom.js";
import { ALL, LISTED } from "../../data.js";
import { columnChart, barList } from "../../components/charts.js";
import { raceChart } from "./race-chart.js";
import "./story.js"; // the story of the year sets itself up
import "./year.css";

export function renderYear() {
  const year = $("#y-year").value;
  const storm = $("#y-storm").checked;
  const info = yearInfo(year, storm, ALL, LISTED);
  const { rows, prevSame, running, partial, lastDate, listed, cutDate, cut, delta } = info;

  const byDay = topCounts(rows, (r) => r.date, 1)[0];
  const byMonth = topCounts(rows, (r) => r.date.slice(5, 7), 1)[0];
  const known = rows.filter((r) => !r.timeUnknown);
  const night = known.filter((r) => r.hour >= NIGHT_START || r.hour < DAY_START).length;
  const period = partial ? ` (jeweils bis ${fmtDate(cutDate).slice(0, 6)})` : "";
  const tiles = [
    ["Einsätze", rows.length, delta !== null ? `${delta >= 0 ? "+" : ""}${delta} % gegenüber ${year - 1}${period}` : ""],
    ["Stärkster Tag", byDay ? fmtDate(byDay[0]) : "–", byDay ? einsaetze(byDay[1].length) : ""],
    ["Stärkster Monat", byMonth ? MONTHS[Number(byMonth[0]) - 1] : "–", byMonth ? einsaetze(byMonth[1].length) : ""],
    ["Nachts", known.length ? Math.round((100 * night) / known.length) + " %" : "–", "zwischen 22 und 6 Uhr"],
  ];
  $("#y-tiles").innerHTML = tiles.map(([l, v, d]) => `<div class="tile"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join("");
  const byHand = rows.filter((r) => r.date > listed).length;
  const listNote = byHand ? `Die Website listet Einsätze bis ${fmtDate(listed)}, ${byHand === 1 ? "1 späterer ist" : `${byHand} spätere sind`} vorläufig eingetragen.`
    : `Die Website listet bisher Einsätze bis ${fmtDate(listed)}.`;
  $("#y-partial").textContent = !partial ? ""
    : running && !byHand ? `Das Jahr ${year} läuft noch: Daten bis ${fmtDate(lastDate)}.`
    : `${running ? `Das Jahr ${year} läuft noch. ` : ""}${listNote}`;
  // Named on screen and on the printout, so a reader knows whether the storm is in the numbers.
  const inView = (r) => r.date.startsWith(year) || (r.date.startsWith(String(year - 1)) && r.date.slice(5) <= cut);
  const big = topCounts(ALL.filter((r) => !r.standby && r.bigDay && inView(r)), (r) => r.date)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, l]) => `${fmtDate(d)} (${einsaetze(l.length)}${d.startsWith(year) ? "" : `, im Vergleich mit ${year - 1}`})`);
  $("#y-storm-note").textContent = big.length ? `Großlagen ${storm ? "mitgezählt" : "nicht mitgezählt"}: ${big.join(", ")}.` : "";

  // Every year's running total; a running year's line stops where its data does.
  const years = [...new Set(info.alarms.map((r) => r.date.slice(0, 4)))].sort();
  const series = years.map((y) => {
    const own = y === year ? info : yearInfo(y, storm, ALL, LISTED);
    return { label: y, sel: y === year, values: runningTotal(own.rows, own.cut), own };
  }).filter((s) => s.values[0] !== null);
  const marks = storm ? topCounts(rows.filter((r) => r.bigDay && r.date.slice(5) <= cut), (r) => r.date)
    .map(([d]) => ({ i: DAY_SLOTS.indexOf(d.slice(5)), text: `Großlage ${fmtDate(d).slice(0, 6)}` })) : [];
  $("#y-race-note").textContent = "Einsätze ab dem 1. Januar, Tag für Tag zusammengezählt. Je steiler die Linie, desto mehr Einsätze in dieser Zeit." +
    series.filter((s) => s.own.partial).map((s) => ` Die Linie für ${s.label} endet am ${fmtDate(s.own.cutDate).slice(0, 6)}` +
      `${s.own.cutDate === s.own.listed ? ", dem Tag des neuesten Einsatzes auf der Website" : ""}.`).join("") +
    (series.some((s) => s.sel) ? "" : ` Für ${year} listet die Website noch keine Einsätze, deshalb fehlt diese Linie noch.`);
  raceChart($("#y-race"), series, { marks: series.some((s) => s.sel) ? marks : [] });

  const months = Array(12).fill(0);
  for (const r of rows) months[Number(r.date.slice(5, 7)) - 1]++;
  columnChart($("#y-months"), months.map((n, m) => ({ value: n, tip: `${MONTHS[m]} ${year}: <b>${einsaetze(n)}</b>`, tick: MONTHS[m] })), { height: 180 });

  const prevGroups = {};
  for (const r of prevSame) prevGroups[r.group] = (prevGroups[r.group] || 0) + 1;
  barList($("#y-groups"), topCounts(rows, (r) => r.group).map(([g, list]) => ({
    label: g, value: list.length, tip: `<b>${esc(g)}</b>: ${einsaetze(list.length)}<br>${year - 1}${partial ? ` bis ${fmtDate(cutDate).slice(0, 6)}` : ""}: ${prevGroups[g] || 0}`,
  })));

  const notable = rows.filter((r) => NOTABLE.test(r.base) || /presseportal/.test(r.remarks));
  $("#y-notable tbody").innerHTML = notable.map((r) =>
    `<tr><td>${fmtDate(r.date)}</td><td>${esc(r.name)}</td><td>${esc(r.event)}</td><td>${esc(r.street)}, ${esc(r.district)}</td></tr>`).join("")
    || `<tr><td colspan="4">Keine</td></tr>`;
}
