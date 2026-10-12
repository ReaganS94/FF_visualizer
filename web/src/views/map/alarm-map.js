// The Karte's map: where the alarms of the selection were, as a heat map, and the Zeitraffer, which plays them on
// the map in date order. The rest of the tab is the React component AlarmMap.jsx. The map isn't drawn by React:
// Leaflet makes it. What the tab shows of the Zeitraffer (the button, the slider, "Zeitraffer beenden") it reads
// with mapView(), and mapSubscribe() tells it when that changes. Which alarms have a position is worked out by
// mapPoints() in lib/places.js.

import { parseDate, isoDate, addDays, fmtDate } from "../../lib/dates.js";
import { loadScript, LEAFLET } from "../../components/leaflet.js";
import "./map.css";

let map, heat;

// What the tab shows of the Zeitraffer: playing while it plays, shown while dots are on the map (from playing or
// the slider), pos the day the slider stands on (days since the first alarm, whole days) and days the last one.
let view = { playing: false, shown: false, pos: 0, days: 0 };
const listeners = new Set();
export const mapView = () => view;
export function mapSubscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function tell(changes) {
  if (Object.entries(changes).every(([k, v]) => view[k] === v)) return;
  view = { ...view, ...changes };
  listeners.forEach((l) => l());
}

// Hands the map the located alarms (mapPoints() in lib/places.js, newest first) each time the tab is drawn, and
// draws the heat map again if the tab shows. el: the map's box.
export async function mapUpdate(el, points) {
  // Only a new selection resets a running time-lapse, not a redraw (a phone's toolbar hiding resizes the window).
  const located = [...points].reverse(); // oldest first
  const key = located.map((l) => l.date + l.p).join("|");
  if (key !== replay.key || !el.offsetWidth) {
    replaySetup(located);
    replay.key = key;
  }
  if (!points.length || !el.offsetWidth) {
    // A heat layer on a hidden map has zero size and throws on redraw, so drop it until visible.
    if (heat) { map.removeLayer(heat); heat = null; }
    return;
  }
  await loadScript(LEAFLET);
  await loadScript("https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js");
  if (!map) {
    map = L.map(el).setView([52.37, 9.73], 13);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const Clock = L.Control.extend({ options: { position: "topright" }, onAdd: () => L.DomUtil.create("div", "rp-clock") });
    replay.clock = new Clock().addTo(map).getContainer();
    replay.clock.hidden = true;
  }
  map.invalidateSize();
  if (heat) map.removeLayer(heat);
  // One warm hue from faint to strong; brighter = more alarms nearby.
  heat = L.heatLayer(points.map(({ p }) => [p[0], p[1], 1]), {
    radius: 22, blur: 18, minOpacity: 0.25, max: 4,
    gradient: { 0.2: "#fde2c4", 0.45: "#f7a35c", 0.7: "#e4572e", 1: "#a3160d" },
  }).addTo(map);
}

// ---------- Zeitraffer ----------
// Plays the selected alarms on the map in date order: each one flashes where it happened and stays
// as a faint dot, so busy places build up. `pos` counts days since the first alarm.
// speed: days per second while playing, as chosen under "Tempo" (normal: a month per second)
const replay = { rows: [], key: "", first: null, days: 0, pos: 0, shown: 0, layer: null, clock: null, raf: 0, speed: 30 };

function replayStop() {
  cancelAnimationFrame(replay.raf);
  replay.raf = 0;
  tell({ playing: false, shown: !!replay.layer, pos: Math.floor(replay.pos) });
}

function replayClear() {
  if (map && replay.layer) map.removeLayer(replay.layer);
  replay.layer = null;
  replay.pos = 0;
  replay.shown = 0;
  replayStop();
  if (replay.clock) replay.clock.hidden = true;
}

function replaySetup(rows) {
  replayClear();
  replay.rows = rows;
  replay.first = rows.length ? parseDate(rows[0].date) : null;
  replay.days = rows.length ? Math.round((parseDate(rows[rows.length - 1].date) - replay.first) / 864e5) : 0;
  tell({ days: replay.days });
}

// Show every alarm up to day `pos`; new ones flash only while playing, not when jumping with the slider.
function replayShow(pos, flash) {
  if (pos < replay.pos || !replay.layer) {
    if (replay.layer) map.removeLayer(replay.layer);
    replay.layer = L.layerGroup().addTo(map);
    replay.shown = 0;
  }
  const until = isoDate(addDays(replay.first, Math.floor(pos)));
  let n = replay.shown;
  for (; n < replay.rows.length && replay.rows[n].date <= until; n++) {
    L.circleMarker(replay.rows[n].p, { radius: 6, stroke: false, interactive: false, className: flash ? "rp-dot rp-flash" : "rp-dot" })
      .addTo(replay.layer);
  }
  replay.shown = n;
  replay.pos = pos;
  replay.clock.hidden = false;
  replay.clock.innerHTML = `<b>${fmtDate(until)}</b>${n} ${n === 1 ? "Einsatz" : "Einsätze"}`;
  tell({ shown: true, pos: Math.floor(pos) });
  if (heat && map.hasLayer(heat)) map.removeLayer(heat);
}

// The button: plays, pauses and goes on playing, or starts over once played to the end.
export function mapPlay() {
  if (!map || !replay.rows.length) return;
  if (replay.raf) { replayStop(); return; } // the button doubles as pause
  if (replay.pos >= replay.days) replayClear(); // finished: start over
  if (!replay.layer) replayShow(0, true);
  let last = performance.now();
  const step = (now) => {
    // at most 0.1 s per frame, so a tab left in the background doesn't jump ahead
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const pos = Math.min(replay.days, replay.pos + dt * replay.speed);
    replayShow(pos, true);
    if (pos >= replay.days) { replay.raf = 0; replayStop(); return; }
    replay.raf = requestAnimationFrame(step);
  };
  replay.raf = requestAnimationFrame(step);
  tell({ playing: true });
}

// "Tempo": how many days pass per second while playing.
export function mapSpeed(days) {
  replay.speed = days;
}

// The slider: shows the alarms up to the chosen day, without flashing.
export function mapSeek(day) {
  if (!map || !replay.rows.length) return;
  replayStop();
  replayShow(day, false);
  replayStop(); // relabel the button now that there is something on the map
}

// "Zeitraffer beenden": back to the heat map.
export function mapEnd() {
  replayClear();
  if (heat) heat.addTo(map);
}
