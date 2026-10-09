// Übersicht: four numbers (alarms, average per week, share at night, the latest alarm) and the alarms per
// month. The warnings box and the offer to put the site on the home screen sit above them on the tab, outside
// React: components/warnings.js and app-offer.js draw those.
import { MONTHS, isoDate, fmtDate } from "../../lib/dates.js";
import { einsaetze, dec } from "../../lib/text.js";
import { perWeek, nightShare, perMonth } from "../../lib/count.js";
import { LISTED } from "../../data.js";
import { columnChart } from "../../components/charts.js";
import Chart from "../../components/Chart.jsx";
import "./app-offer.js"; // the offer to put the site on the home screen sets itself up

// rows: the alarms chosen with the filters above the tabs, newest first; year: the year chosen there ("" for all).
export default function Overview({ rows, year }) {
  // the weekly average only counts the days the website covers; days after its newest alarm hold only hand entries
  const week = perWeek(rows, year, isoDate(LISTED));
  const night = nightShare(rows);
  const latest = rows[0];
  const tiles = [
    ["Einsätze", rows.length, "in der Auswahl"],
    ["Ø pro Woche", week ? dec(week.value) : "–", week && week.to < latest.date ? `bis ${fmtDate(week.to)}` : "über den gewählten Zeitraum"],
    ["Nachts", night === null ? "–" : `${night} %`, "zwischen 22 und 6 Uhr"],
    ["Letzter Einsatz", latest ? fmtDate(latest.date) : "–",
      // the event and the tag's space are one piece of text, as before
      latest?.manual ? <>{`${latest.event} `}<span className="tag">vorläufig</span></> : latest?.event],
  ];
  const months = perMonth(rows);
  return (
    <>
      <div className="tiles" id="tiles">
        {tiles.map(([l, v, d]) => (
          <div className="tile" key={l}><div className="l">{l}</div><div className="v">{v}</div><div className="d">{d}</div></div>
        ))}
      </div>
      <h2>Einsätze pro Monat</h2>
      <Chart id="c-months" draw={(box) => drawMonths(box, months)} />
    </>
  );
}

// A column per month. Under the columns on a narrow screen, January says its year; on a wider one, January and the
// first month say month and year, and every third month its name.
function drawMonths(box, months) {
  if (!months.length) { box.innerHTML = ""; return; }
  const narrow = box.clientWidth < 600;
  columnChart(box, months.map(({ year, month, n }, i) => ({
    value: n,
    tip: `${MONTHS[month]} ${year}: <b>${einsaetze(n)}</b>`,
    tick: narrow ? (month === 0 ? String(year) : "") : month === 0 || i === 0 ? `${MONTHS[month]} ${year}` : month % 3 === 0 ? MONTHS[month] : "",
  })));
}
