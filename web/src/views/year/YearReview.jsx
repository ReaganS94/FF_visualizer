// Jahresrückblick: a year's numbers, its running total next to the other years, its months, alarm types and
// notable alarms. What a year counts and compares with is worked out in lib/year.js; this draws the tab. The year
// and "Großlagen mitzählen" are chosen in the tab itself: the filters above the tabs don't apply here. The running
// totals are drawn by race-chart.js, the story of the year by story.js.
import { useState } from "react";
import { MONTHS, fmtDate } from "../../lib/dates.js";
import { esc, einsaetze } from "../../lib/text.js";
import { DAY_START, NIGHT_START } from "../../lib/estimate.js";
import { NOTABLE, yearInfo, DAY_SLOTS, runningTotal } from "../../lib/year.js";
import { topCounts } from "../../lib/count.js";
import { alarmKey } from "../../lib/alarms.js";
import { ALL, LISTED } from "../../data.js";
import { columnChart, barList } from "../../components/charts.js";
import Chart from "../../components/Chart.jsx";
import { raceChart } from "./race-chart.js";
import { storyOpen } from "./story.js";
import "./year.css";

export default function YearReview() {
  // Every year with alarms, newest first; the newest is the one shown first.
  const years = [...new Set(ALL.map((r) => r.date.slice(0, 4)))].sort().reverse();
  const [year, setYear] = useState(years[0] ?? "");
  const [storm, setStorm] = useState(true);
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
  const byHand = rows.filter((r) => r.date > listed).length;
  const listNote = byHand ? `Die Website listet Einsätze bis ${fmtDate(listed)}, ${byHand === 1 ? "1 späterer ist" : `${byHand} spätere sind`} vorläufig eingetragen.`
    : `Die Website listet bisher Einsätze bis ${fmtDate(listed)}.`;
  const partialNote = !partial ? ""
    : running && !byHand ? `Das Jahr ${year} läuft noch: Daten bis ${fmtDate(lastDate)}.`
    : `${running ? `Das Jahr ${year} läuft noch. ` : ""}${listNote}`;
  // Named on screen and on the printout, so a reader knows whether the storm is in the numbers.
  const inView = (r) => r.date.startsWith(year) || (r.date.startsWith(String(year - 1)) && r.date.slice(5) <= cut);
  const big = topCounts(ALL.filter((r) => !r.standby && r.bigDay && inView(r)), (r) => r.date)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, l]) => `${fmtDate(d)} (${einsaetze(l.length)}${d.startsWith(year) ? "" : `, im Vergleich mit ${year - 1}`})`);
  const stormNote = big.length ? `Großlagen ${storm ? "mitgezählt" : "nicht mitgezählt"}: ${big.join(", ")}.` : "";

  // Every year's running total; a running year's line stops where its data does.
  const lines = [...new Set(info.alarms.map((r) => r.date.slice(0, 4)))].sort();
  const series = lines.map((y) => {
    const own = y === year ? info : yearInfo(y, storm, ALL, LISTED);
    return { label: y, sel: y === year, values: runningTotal(own.rows, own.cut), own };
  }).filter((s) => s.values[0] !== null);
  const marks = storm ? topCounts(rows.filter((r) => r.bigDay && r.date.slice(5) <= cut), (r) => r.date)
    .map(([d]) => ({ i: DAY_SLOTS.indexOf(d.slice(5)), text: `Großlage ${fmtDate(d).slice(0, 6)}` })) : [];
  const raceNote = "Einsätze ab dem 1. Januar, Tag für Tag zusammengezählt. Je steiler die Linie, desto mehr Einsätze in dieser Zeit." +
    series.filter((s) => s.own.partial).map((s) => ` Die Linie für ${s.label} endet am ${fmtDate(s.own.cutDate).slice(0, 6)}` +
      `${s.own.cutDate === s.own.listed ? ", dem Tag des neuesten Einsatzes auf der Website" : ""}.`).join("") +
    (series.some((s) => s.sel) ? "" : ` Für ${year} listet die Website noch keine Einsätze, deshalb fehlt diese Linie noch.`);

  const months = Array(12).fill(0);
  for (const r of rows) months[Number(r.date.slice(5, 7)) - 1]++;
  const columns = months.map((n, m) => ({ value: n, tip: `${MONTHS[m]} ${year}: <b>${einsaetze(n)}</b>`, tick: MONTHS[m] }));

  const prevGroups = {};
  for (const r of prevSame) prevGroups[r.group] = (prevGroups[r.group] || 0) + 1;
  const groups = topCounts(rows, (r) => r.group).map(([g, list]) => ({
    label: g, value: list.length, tip: `<b>${esc(g)}</b>: ${einsaetze(list.length)}<br>${year - 1}${partial ? ` bis ${fmtDate(cutDate).slice(0, 6)}` : ""}: ${prevGroups[g] || 0}`,
  }));

  const notable = rows.filter((r) => NOTABLE.test(r.base) || /presseportal/.test(r.remarks));
  return (
    <>
      <div className="year-head">
        <label>Jahr <select id="y-year" value={year} onChange={(e) => setYear(e.target.value)}>
          {years.map((y) => <option key={y}>{y}</option>)}
        </select></label>
        <label><input type="checkbox" id="y-storm" checked={storm} onChange={(e) => setStorm(e.target.checked)} /> Großlagen mitzählen</label>
        <button id="y-story" type="button" className="primary" onClick={() => storyOpen(year, storm)}>▶ Das Jahr als Story</button>
        <button id="y-print" type="button" onClick={() => window.print()}>Drucken / als PDF speichern</button>
      </div>
      <h2 className="print-only">FF Linden Jahresrückblick</h2>
      <p className="note" id="y-partial">{partialNote}</p>
      <p className="note" id="y-storm-note">{stormNote}</p>
      <div className="tiles" id="y-tiles">
        {tiles.map(([l, v, d]) => (
          <div className="tile" key={l}><div className="l">{l}</div><div className="v">{v}</div><div className="d">{d}</div></div>
        ))}
      </div>
      <h2>Jahresvergleich</h2>
      <p className="note" id="y-race-note">{raceNote}</p>
      <Chart id="y-race" draw={(box) => raceChart(box, series, { marks: series.some((s) => s.sel) ? marks : [] })} />
      <h2>Einsätze pro Monat</h2>
      <Chart id="y-months" draw={(box) => columnChart(box, columns, { height: 180 })} />
      <h2>Nach Einsatzart</h2>
      <Chart id="y-groups" draw={(box) => barList(box, groups)} />
      <h2>Besondere Einsätze</h2>
      <p className="note">Größere Einsätze (z. B. b2, b3, Wasserrettung, MANV) und Einsätze mit Pressebericht. Wachbesetzungen sind nicht mitgezählt.</p>
      <div className="table-wrap"><table id="y-notable">
        <thead><tr><th>Datum</th><th>Art</th><th>Ereignis</th><th>Ort</th></tr></thead>
        <tbody>
          {notable.length ? notable.map((r) => (
            <tr key={alarmKey(r)}><td>{fmtDate(r.date)}</td><td>{r.name}</td><td>{r.event}</td><td>{`${r.street}, ${r.district}`}</td></tr>
          )) : <tr><td colSpan="4">Keine</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}
