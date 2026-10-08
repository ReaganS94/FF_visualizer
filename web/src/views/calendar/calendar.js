// Kalender: every day of each year as a square, by week and weekday, darker the more alarms it had.

import { WEEKDAYS, MONTHS, isoDate, addDays, weekday, fmtDate } from "../../lib/dates.js";
import { esc, einsaetze, weitere } from "../../lib/text.js";
import { BIG_DAY } from "../../lib/alarms.js";
import { $ } from "../../dom.js";
import { ALL, LISTED } from "../../data.js";
import { rampColors, legend } from "../../components/charts.js";
import "./calendar.css";

export function renderCalendar(rows) {
  const colors = rampColors();
  const bin = (n) => (n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : n < BIG_DAY ? 4 : 5);
  const perDay = {};
  for (const r of rows) (perDay[r.date] ||= []).push(r);
  const years = [...new Set(rows.map((r) => r.date.slice(0, 4)))].sort().reverse();
  const C = 18, G = 3, L = 26, T = 16;
  const today = isoDate(new Date()), listed = isoDate(LISTED);
  // Like the spiral: say so on hidden Großlage days and on days the website hasn't reached, instead of just "0".
  const hiddenBig = {};
  if (!$("#f-storm").checked) for (const r of ALL) if (r.bigDay && !r.standby) hiddenBig[r.date] = (hiddenBig[r.date] || 0) + 1;
  let html = "";
  for (const y of years) {
    const jan1 = new Date(Number(y), 0, 1);
    const off = weekday(jan1);
    let s = `<svg viewBox="0 0 ${L + 54 * (C + G)} ${T + 7 * (C + G)}" role="img">`;
    WEEKDAYS.forEach((w, i) => { if (i % 2 === 0) s += `<text x="0" y="${T + i * (C + G) + 13}">${w}</text>`; });
    for (let d = jan1; d.getFullYear() === Number(y); d = addDays(d, 1)) {
      const doy = Math.round((d - jan1) / 864e5);
      const col = Math.floor((doy + off) / 7), row = weekday(d);
      if (d.getDate() === 1) s += `<text x="${L + col * (C + G)}" y="11">${MONTHS[d.getMonth()]}</text>`;
      const date = isoDate(d);
      if (date > today) continue;
      const list = perDay[date] || [];
      const tipText = `<b>${fmtDate(date)}</b> · ${einsaetze(list.length)}` +
        list.slice(0, 6).map((r) => `<br>${r.timeUnknown ? "" : `${esc(r.time)} `}${esc(r.keyword)} – ${esc(r.event)}`).join("") +
        (list.length > 6 ? `<br>… und ${weitere(list.length - 6)}` : "") +
        (hiddenBig[date] ? `<br>Großlage mit ${einsaetze(hiddenBig[date], true)}, nicht mitgezählt` : "") +
        (date > listed ? "<br>Noch nicht auf der Website" : "");
      s += `<rect class="cell${date > listed ? " unlisted" : ""}" x="${L + col * (C + G)}" y="${T + row * (C + G)}" width="${C}" height="${C}" rx="3" fill="${colors[bin(list.length)]}" data-tip="${esc(tipText)}"/>`;
    }
    html += `<div class="year-label">${y}</div>${s}</svg>`;
  }
  html += legend(["0", "1", "2", "3–4", `5–${BIG_DAY - 1}`, `${BIG_DAY}+`], colors);
  $("#c-calendar").innerHTML = html;
}
