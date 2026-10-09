// Einsatzradius: how far from the Wache the alarms were. The map, with a line from the Wache to every alarm and
// "Abspielen", which sends the lines out in date order, is drawn by radius-map.js; this draws the rest of the tab
// and what changes while the lines go out: the tiles and the distance bars, the button and the note under the map.
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { fmtDate } from "../../lib/dates.js";
import { einsaetze, fmtKm } from "../../lib/text.js";
import { pct } from "../../lib/count.js";
import { RADIUS_BINS, radiusPoints, radiusSummary } from "../../lib/places.js";
import { GEO } from "../../data.js";
import { barList } from "../../components/charts.js";
import Chart from "../../components/Chart.jsx";
import { radiusUpdate, radiusPlay, radiusFit, radiusSpeed, radiusView, radiusSubscribe } from "./radius-map.js";

// What a press on the button does next, for each phase of the playback.
const BUTTON = { start: "▶ Abspielen", playing: "❚❚ Pause", paused: "▶ Weiter", done: "▶ Nochmal abspielen" };

// rows: the alarms chosen with the filters above the tabs.
export default function Radius({ rows }) {
  const pts = useMemo(() => radiusPoints(rows, GEO), [rows]);
  const { phase, shown, outside } = useSyncExternalStore(radiusSubscribe, radiusView);
  const mapBox = useRef(null);
  // Each time main.js draws the tab (for a new selection, a tab change or a new window width; rows is a new list
  // each time), the map takes the alarms, which starts the playback over for a new selection, and is drawn again.
  // Not when the playback draws the tab: the map draws itself then.
  useLayoutEffect(() => { radiusUpdate(mapBox.current, pts); }, [pts]);
  // On phones the map sits below the controls, so playing brings it into view, once the tiles show the start.
  useLayoutEffect(() => {
    if (phase === "playing") mapBox.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [phase]);

  const missing = rows.length - pts.length;
  const note = !Object.keys(GEO).length ? "Die Karte erscheint nach der nächsten täglichen Aktualisierung."
    : missing ? `${missing} ${missing === 1 ? "Einsatz" : "Einsätze"} ohne bekannte Adresse (z. B. Autobahn) ${missing === 1 ? "fehlt" : "fehlen"}.` : "";
  // The tiles and bars count what's on the map: every alarm, or the ones sent out so far while playing.
  const { n, median, within2, far, bins } = radiusSummary(shown === null ? pts : pts.slice(0, shown));
  const tiles = [
    [n ? fmtKm(median) : "–", "Die Hälfte der Einsätze liegt näher als das"],
    [n ? `${pct(within2, n)}\u00a0%` : "–", "im Umkreis von 2 km"],
    [far ? fmtKm(far.km) : "–", "am weitesten weg", far && `${far.r.street}, ${far.r.district}, ${fmtDate(far.r.date)}`],
  ];
  // The bars keep the scale of all alarms while they fill up during playback.
  const scaleTo = Math.max(1, ...radiusSummary(pts).bins);
  const items = RADIUS_BINS.map(([, , label], i) => ({
    label, value: bins[i], tip: `${label}: ${einsaetze(bins[i])}${n ? ` (${pct(bins[i], n)}\u00a0%)` : ""}`,
  }));
  return (
    <>
      <h2>Wie weit fährt die Feuerwehr Linden?</h2>
      <p className="note">Jede Linie führt von der Wache in der Teichstraße 8 zu einem Einsatz. Die Entfernung ist Luftlinie, keine Fahrstrecke. „Abspielen“ schickt die Linien der Reihe nach los. <span id="radius-note">{note}</span></p>
      <div className="tiles" id="radius-tiles">
        {tiles.map(([v, l, d], i) => (
          <div className="tile" key={i}><div className="v">{v}</div><div className="l">{l}</div>{d && <div className="d">{d}</div>}</div>
        ))}
      </div>
      <div className="replay">
        <button type="button" id="ra-play" className="primary" disabled={!pts.length} onClick={radiusPlay}>{BUTTON[phase]}</button>
        <label>Tempo <select id="ra-speed" defaultValue="30" onChange={(e) => radiusSpeed(Number(e.target.value))}>
          <option value="7">langsam (1 Woche pro Sekunde)</option>
          <option value="30">normal (1 Monat pro Sekunde)</option>
          <option value="91">schnell (1 Quartal pro Sekunde)</option>
        </select></label>
        <div className="seg" role="group" aria-label="Ausschnitt">
          <span>Ausschnitt</span>
          <button type="button" data-radius="near" onClick={() => radiusFit("near")}>Linden</button>
          <button type="button" data-radius="all" onClick={() => radiusFit("all")}>Alle Einsätze</button>
        </div>
      </div>
      <div className="legend dots-legend">
        <span><i className="wache" />Wache</span><span><i className="brand" />Brand</span><span><i className="hilfe" />Technische Hilfe</span>
        <span><i className="unwetter" />Unwetter</span><span><i className="other" />Andere</span>
      </div>
      {/* Leaflet draws the map into this box, and the lines go on a canvas in it: React only makes the box. */}
      <div id="c-radius" ref={mapBox} hidden={!pts.length} />
      <p className="note" id="radius-outside">{outside ? `${outside} ${outside === 1 ? "Einsatz liegt" : "Einsätze liegen"} außerhalb des Ausschnitts.` : ""}</p>
      <h2>Wie weit weg?</h2>
      <Chart id="c-radius-km" draw={(box) => barList(box, items, { labelWidth: 90, scaleTo })} />
    </>
  );
}
