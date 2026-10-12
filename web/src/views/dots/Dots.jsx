// Punktewand: every alarm is one dot, coloured by its type. Switching the grouping moves each dot to its new
// place. Which colour and which group a dot gets, and where it goes: dotKind, dotGroups and dotLayout in
// lib/places.js.
import { memo, useLayoutEffect, useRef, useState } from "react";
import { WEEKDAYS, WEEKDAYS_LONG, parseDate, weekday, fmtDate } from "../../lib/dates.js";
import { esc, einsaetze } from "../../lib/text.js";
import { alarmKey } from "../../lib/alarms.js";
import { dotKind, dotLayout } from "../../lib/places.js";
import "./dots.css";

const GROUPINGS = [["month", "Monat"], ["type", "Einsatzart"], ["district", "Stadtteil"], ["hour", "Uhrzeit"]];
const place = (a) => [a.street, a.district].filter(Boolean).join(", ");

// The dots of one drawing: drawn.rows at drawn.width. A new grouping keeps the dots and only gives them new
// places, which the styles in dots.css turn into a move.
const DotWall = memo(function DotWall({ drawn, by, picked, onPick }) {
  const { rows, width } = drawn;
  const { pos, labels, H, r } = dotLayout(rows, by, width);
  return (
    <svg viewBox={`0 0 ${width} ${H}`} height={H} role="img" aria-label={`${einsaetze(rows.length)} als Punkte`}>
      <g className="dot-labels">
        {labels.map((l, k) => <text key={k} x={l.x} y={l.y} textAnchor={l.anchor} className={l.count ? "count" : undefined}>{l.text}</text>)}
      </g>
      <g className="dots">
        {rows.map((a, i) => {
          const [x, y] = pos.get(a);
          const tip = `<b>${WEEKDAYS[weekday(parseDate(a.date))]}, ${fmtDate(a.date)}</b>${a.timeUnknown ? "" : `, ${esc(a.time)} Uhr`}<br>` +
            `${esc(a.keyword)} · ${esc(a.name)}<br>${esc(a.event)}<br>${esc(place(a))}`;
          return (
            <circle key={alarmKey(a)} className={`dot ${dotKind(a)}${a === picked ? " on" : ""}`} r={r.toFixed(1)} data-tip={tip} onClick={() => onPick(a)}
              style={{ transform: `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`, "--d": `${(i * 37) % 400}ms` }} />
          );
        })}
      </g>
    </svg>
  );
});

// rows: the alarms chosen with the filters above the tabs.
export default function Dots({ rows }) {
  const [by, setBy] = useState("month");
  const [picked, setPicked] = useState(null); // the tapped alarm
  const [drawn, setDrawn] = useState(null); // the alarms and the width the dots were last drawn for
  const box = useRef(null);
  // Each time main.js draws the tab (rows is a new list each time), the dots are drawn afresh at the chart's
  // width, as before React, and a tapped alarm stays picked if it is still there. Not while the tab is hidden:
  // the chart has no width then, and is drawn when the tab opens.
  useLayoutEffect(() => {
    const width = box.current.clientWidth;
    if (!width) return;
    setDrawn((d) => ({ rows, width, n: (d?.n ?? 0) + 1 }));
    setPicked((a) => (rows.includes(a) ? a : null));
  }, [rows]);

  const a = picked;
  return (
    <>
      <h2>Jeder Einsatz ein Punkt</h2>
      <div className="seg" id="dots-by" role="group" aria-label="Gruppieren nach">
        <span>Gruppieren nach</span>
        {GROUPINGS.map(([k, label]) => (
          <button type="button" data-by={k} className={by === k ? "active" : undefined} key={k} onClick={() => setBy(k)}>{label}</button>
        ))}
      </div>
      <div className="legend dots-legend">
        <span><i className="brand" />Brand</span><span><i className="hilfe" />Technische Hilfe</span><span><i className="unwetter" />Unwetter</span>
        <span><i className="other" />Andere</span>
      </div>
      {/* A tap on a dot picks its alarm, a tap next to the dots lets go of it. A new drawing makes new dots
          (the key), so they show at their places at once instead of moving there. */}
      <div className="chart" id="c-dots" ref={box} onClick={(e) => { if (!e.target.closest(".dot")) setPicked(null); }}>
        {drawn && <DotWall key={drawn.n} drawn={drawn} by={by} picked={picked} onPick={setPicked} />}
      </div>
      <p className="note" id="dots-detail" aria-live="polite">
        {a ? (
          <><b>{`${WEEKDAYS_LONG[weekday(parseDate(a.date))]}, ${fmtDate(a.date)}${a.timeUnknown ? "" : `, ${a.time} Uhr`}`}</b>{` · ${a.keyword} ${a.name} · ${a.event} · ${place(a)}`}</>
        ) : "Einen Punkt antippen, um den Einsatz zu sehen."}
      </p>
      <p className="note">Grau sind Gas &amp; Gefahrstoffe, Rettungsdienst und Sonstiges. Monate zählen über alle gewählten Jahre zusammen. „?“ bei der Uhrzeit sind Einsätze einer Großlage, die ohne echte Uhrzeit eingetragen wurden.</p>
    </>
  );
}
