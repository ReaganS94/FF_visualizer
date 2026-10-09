// Tageszeit: the alarms by weekday and hour as a grid, and by hour as bars.
import { Fragment } from "react";
import { WEEKDAYS, WEEKDAYS_LONG } from "../../lib/dates.js";
import { einsaetze } from "../../lib/text.js";
import { weekHours, heatLevel } from "../../lib/count.js";
import { columnChart, rampColors } from "../../components/charts.js";
import Chart from "../../components/Chart.jsx";
import Legend from "../../components/Legend.jsx";
import "./hours.css";

const C = 36, G = 3, L = 30, T = 18; // a cell's size, the gap between cells, and the room for the labels left and above

// rows: the alarms chosen with the filters above the tabs. The tooltips are HTML (components/tooltip.js).
export default function Hours({ rows }) {
  const { grid, hours } = weekHours(rows);
  const max = Math.max(1, ...grid.flat());
  const colors = rampColors();
  return (
    <>
      <h2>Wochentag × Uhrzeit</h2>
      <p className="note">Einsätze einer Großlage, die ohne echte Uhrzeit eingetragen wurden, fehlen hier.</p>
      <div className="chart" id="c-heat">
        <svg viewBox={`0 0 ${L + 24 * (C + G)} ${T + 7 * (C + G)}`} role="img">
          {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
            <text key={h} x={L + h * (C + G) + C / 2} y="12" textAnchor="middle">{`${h} Uhr`}</text>
          ))}
          {grid.map((line, w) => (
            <Fragment key={w}>
              <text x="0" y={T + w * (C + G) + C / 2 + 4}>{WEEKDAYS[w]}</text>
              {line.map((n, h) => (
                <rect key={h} className="cell" x={L + h * (C + G)} y={T + w * (C + G)} width={C} height={C} rx="3"
                  fill={colors[heatLevel(n, max)]} data-tip={`${WEEKDAYS_LONG[w]}, ${h}–${h + 1} Uhr: <b>${einsaetze(n)}</b>`} />
              ))}
            </Fragment>
          ))}
        </svg>
        <Legend labels={["0", "", "", "", "", `${max} (Maximum)`]} colors={colors} />
      </div>
      <h2>Nach Uhrzeit</h2>
      <Chart id="c-hours" draw={(box) => columnChart(box, hours.map((n, h) => (
        { value: n, tip: `${h}–${h + 1} Uhr: <b>${einsaetze(n)}</b>`, tick: h % 3 === 0 ? `${h}` : "" })), { height: 180 })} />
    </>
  );
}
