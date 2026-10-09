// Karte: where the alarms of the selection were, as a heat map, and the Zeitraffer, which plays them on the map
// in date order.

import { parseDate, isoDate, addDays, fmtDate } from "../../lib/dates.js";
import { einsaetze } from "../../lib/text.js";
import { $ } from "../../dom.js";
import { GEO } from "../../data.js";
import { loadScript, LEAFLET } from "../../components/leaflet.js";
import "./map.css";

let map, heat;

export async function renderMap(rows) {
  const el = $("#c-map");
  const points = [];
  const located = [];
  let missing = 0;
  for (const r of rows) {
    // Positions are stored under the spelling as entered; a new spelling of a known street isn't looked up yet.
    const p = GEO[r.geoKey] || GEO[`${r.street}|${r.district}`];
    if (p) { points.push([p[0], p[1], 1]); located.push({ p, date: r.date }); } else missing++;
  }
  // Only a new selection resets a running time-lapse, not a redraw (a phone's toolbar hiding resizes the window).
  located.reverse(); // oldest first
  const key = located.map((l) => l.date + l.p).join("|");
  if (key !== replay.key || !el.offsetWidth) {
    replaySetup(located);
    replay.key = key;
  }
  $("#map-note").textContent = Object.keys(GEO).length
    ? `${einsaetze(points.length)} auf der Karte.` +
      (missing ? ` ${missing} ohne bekannte Adresse (z. B. Autobahn) ${missing === 1 ? "fehlt" : "fehlen"}.` : "")
    : "Die Karte erscheint nach der nächsten täglichen Aktualisierung.";
  el.hidden = !points.length;
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
  heat = L.heatLayer(points, {
    radius: 22, blur: 18, minOpacity: 0.25, max: 4,
    gradient: { 0.2: "#fde2c4", 0.45: "#f7a35c", 0.7: "#e4572e", 1: "#a3160d" },
  }).addTo(map);
}

// ---------- Zeitraffer ----------
// Plays the selected alarms on the map in date order: each one flashes where it happened and stays
// as a faint dot, so busy places build up. `pos` counts days since the first alarm.
const replay = { rows: [], key: "", first: null, days: 0, pos: 0, shown: 0, layer: null, clock: null, raf: 0 };

function replayStop() {
  cancelAnimationFrame(replay.raf);
  replay.raf = 0;
  $("#rp-play").textContent = replay.pos >= replay.days && replay.layer ? "▶ Nochmal abspielen"
    : replay.layer ? "▶ Weiter" : "▶ Zeitraffer abspielen";
}

function replayClear() {
  if (map && replay.layer) map.removeLayer(replay.layer);
  replay.layer = null;
  replay.pos = 0;
  replay.shown = 0;
  replayStop();
  if (replay.clock) replay.clock.hidden = true;
  $("#rp-pos").value = 0;
  $("#rp-reset").hidden = true;
}

function replaySetup(rows) {
  replayClear();
  replay.rows = rows;
  replay.first = rows.length ? parseDate(rows[0].date) : null;
  replay.days = rows.length ? Math.round((parseDate(rows[rows.length - 1].date) - replay.first) / 864e5) : 0;
  $("#rp-pos").max = replay.days;
  $("#rp-play").disabled = !rows.length;
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
  $("#rp-pos").value = Math.floor(pos);
  $("#rp-reset").hidden = false;
  if (heat && map.hasLayer(heat)) map.removeLayer(heat);
}

function replayPlay() {
  if (!map || !replay.rows.length) return;
  if (replay.raf) { replayStop(); return; } // the button doubles as pause
  if (replay.pos >= replay.days) replayClear(); // finished: start over
  if (!replay.layer) replayShow(0, true);
  $("#c-map").scrollIntoView({ block: "nearest", behavior: "smooth" }); // on phones the map sits below the controls
  $("#rp-play").textContent = "❚❚ Pause";
  let last = performance.now();
  const step = (now) => {
    // at most 0.1 s per frame, so a tab left in the background doesn't jump ahead
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const pos = Math.min(replay.days, replay.pos + dt * Number($("#rp-speed").value));
    replayShow(pos, true);
    if (pos >= replay.days) { replay.raf = 0; replayStop(); return; }
    replay.raf = requestAnimationFrame(step);
  };
  replay.raf = requestAnimationFrame(step);
}

$("#rp-play").addEventListener("click", replayPlay);
$("#rp-pos").addEventListener("input", (e) => {
  if (!map || !replay.rows.length) return;
  replayStop();
  replayShow(Number(e.target.value), false);
  replayStop(); // relabel the button now that there is something on the map
});
$("#rp-reset").addEventListener("click", () => {
  replayClear();
  if (heat) heat.addTo(map);
});
