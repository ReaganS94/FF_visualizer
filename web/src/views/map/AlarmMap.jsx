// Karte: where the alarms of the selection were, as a heat map, and the Zeitraffer, which plays them on the map
// in date order. The map and the Zeitraffer's dots are drawn by alarm-map.js; this draws the rest of the tab and
// what changes while the Zeitraffer plays: the button, the slider and "Zeitraffer beenden".
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { einsaetze } from "../../lib/text.js";
import { mapPoints } from "../../lib/places.js";
import { GEO } from "../../data.js";
import { mapUpdate, mapPlay, mapSpeed, mapSeek, mapEnd, mapView, mapSubscribe } from "./alarm-map.js";

// rows: the alarms chosen with the filters above the tabs.
export default function AlarmMap({ rows }) {
  const { points, missing } = useMemo(() => mapPoints(rows, GEO), [rows]);
  const { playing, shown, pos, days } = useSyncExternalStore(mapSubscribe, mapView);
  const mapBox = useRef(null), slider = useRef(null);
  // Each time main.js draws the tab (for a new selection, a tab change or a new window width; rows is a new list
  // each time), the map takes the alarms, which starts the Zeitraffer over for a new selection or while the tab
  // is hidden, and draws the heat map again.
  useLayoutEffect(() => { mapUpdate(mapBox.current, points); }, [points]);
  // The slider follows the Zeitraffer; while it is dragged, it is where it was dragged to.
  useLayoutEffect(() => { slider.current.value = pos; }, [pos]);
  // On phones the map sits below the controls, so playing brings it into view.
  useLayoutEffect(() => {
    if (playing) mapBox.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [playing]);

  const note = Object.keys(GEO).length
    ? `${einsaetze(points.length)} auf der Karte.` +
      (missing ? ` ${missing} ohne bekannte Adresse (z. B. Autobahn) ${missing === 1 ? "fehlt" : "fehlen"}.` : "")
    : "Die Karte erscheint nach der nächsten täglichen Aktualisierung.";
  // What a press on the button does next.
  const button = playing ? "❚❚ Pause" : shown && pos >= days ? "▶ Nochmal abspielen" : shown ? "▶ Weiter" : "▶ Zeitraffer abspielen";
  return (
    <>
      <h2>Wo gab es die meisten Einsätze?</h2>
      <p className="note" id="map-note">{note}</p>
      <div className="replay">
        <button type="button" id="rp-play" className="primary" disabled={!points.length} onClick={mapPlay}>{button}</button>
        <label>Tempo <select id="rp-speed" defaultValue="30" onChange={(e) => mapSpeed(Number(e.target.value))}>
          <option value="7">langsam (1 Woche pro Sekunde)</option>
          <option value="30">normal (1 Monat pro Sekunde)</option>
          <option value="91">schnell (1 Quartal pro Sekunde)</option>
        </select></label>
        <input type="range" id="rp-pos" ref={slider} min="0" max={days} defaultValue="0" aria-label="Datum im Zeitraffer"
          onInput={(e) => mapSeek(Number(e.target.value))} />
        <button type="button" id="rp-reset" hidden={!shown} onClick={mapEnd}>Zeitraffer beenden</button>
      </div>
      {/* Leaflet draws the map into this box: React only makes the box. */}
      <div id="c-map" ref={mapBox} hidden={!points.length} />
    </>
  );
}
