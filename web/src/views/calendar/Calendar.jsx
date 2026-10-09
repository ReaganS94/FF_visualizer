// Kalender: every day of each year as a square, by week and weekday, darker the more alarms it had.
import { WEEKDAYS, MONTHS, isoDate, addDays, weekday, fmtDate } from "../../lib/dates.js";
import { esc, einsaetze, weitere } from "../../lib/text.js";
import { BIG_DAY } from "../../lib/alarms.js";
import { bigDayCounts, dayLevel } from "../../lib/count.js";
import { ALL, LISTED } from "../../data.js";
import { rampColors } from "../../components/charts.js";
import Legend from "../../components/Legend.jsx";
import "./calendar.css";

const C = 18, G = 3, L = 26, T = 16; // a day's size, the gap between days, and the room for the labels left and above

// rows: the alarms chosen with the filters above the tabs; storm: whether "Großlagen mitzählen" is on. The tooltips
// are HTML (components/tooltip.js).
export default function Calendar({ rows, storm }) {
  const colors = rampColors();
  const perDay = {};
  for (const r of rows) (perDay[r.date] ||= []).push(r);
  const years = [...new Set(rows.map((r) => r.date.slice(0, 4)))].sort().reverse();
  const today = isoDate(new Date()), listed = isoDate(LISTED);
  // Like the spiral: say so on hidden Großlage days and on days the website hasn't reached, instead of just "0".
  const hiddenBig = storm ? {} : bigDayCounts(ALL);
  return (
    <>
      <h2>Einsätze pro Tag</h2>
      <div id="c-calendar">
        {years.map((y) => (
          <Year key={y} year={y} perDay={perDay} hiddenBig={hiddenBig} today={today} listed={listed} colors={colors} />
        ))}
        <Legend labels={["0", "1", "2", "3–4", `5–${BIG_DAY - 1}`, `${BIG_DAY}+`]} colors={colors} />
      </div>
    </>
  );
}

// One year: a column per week, a row per weekday, with the months above. Days after today have no square.
function Year({ year, perDay, hiddenBig, today, listed, colors }) {
  const jan1 = new Date(Number(year), 0, 1);
  const off = weekday(jan1);
  const days = []; // the month names and the squares, in the order of the days
  for (let d = jan1; d.getFullYear() === Number(year); d = addDays(d, 1)) {
    const doy = Math.round((d - jan1) / 864e5);
    const col = Math.floor((doy + off) / 7), row = weekday(d);
    if (d.getDate() === 1) days.push(<text key={`m${d.getMonth()}`} x={L + col * (C + G)} y="11">{MONTHS[d.getMonth()]}</text>);
    const date = isoDate(d);
    if (date > today) continue;
    const list = perDay[date] || [];
    const tipText = `<b>${fmtDate(date)}</b> · ${einsaetze(list.length)}` +
      list.slice(0, 6).map((r) => `<br>${r.timeUnknown ? "" : `${esc(r.time)} `}${esc(r.keyword)} – ${esc(r.event)}`).join("") +
      (list.length > 6 ? `<br>… und ${weitere(list.length - 6)}` : "") +
      (hiddenBig[date] ? `<br>Großlage mit ${einsaetze(hiddenBig[date], true)}, nicht mitgezählt` : "") +
      (date > listed ? "<br>Noch nicht auf der Website" : "");
    days.push(
      <rect key={date} className={date > listed ? "cell unlisted" : "cell"} x={L + col * (C + G)} y={T + row * (C + G)}
        width={C} height={C} rx="3" fill={colors[dayLevel(list.length)]} data-tip={tipText} />,
    );
  }
  return (
    <>
      <div className="year-label">{year}</div>
      <svg viewBox={`0 0 ${L + 54 * (C + G)} ${T + 7 * (C + G)}`} role="img">
        {WEEKDAYS.map((w, i) => i % 2 === 0 && <text key={w} x="0" y={T + i * (C + G) + 13}>{w}</text>)}
        {days}
      </svg>
    </>
  );
}
