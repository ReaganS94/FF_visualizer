// The Einsatzradius's map: a line from the Wache to every alarm, over a grey map; "Abspielen" sends the lines out
// in date order. The rest of the tab is the React component Radius.jsx. The map isn't drawn by React: Leaflet
// makes it, and the lines and dots go on a canvas over it, drawn again with every frame while playing. What the
// tab shows of it (the button, how many alarms are out so far, how many lie outside the map) it reads with
// radiusView(), and radiusSubscribe() tells it when that changes. The distances are worked out in lib/places.js.

import { parseDate, isoDate, addDays, fmtDate } from "../../lib/dates.js";
import { esc, einsaetze, fmtKm } from "../../lib/text.js";
import { DOT_ORDER, WACHE, KM_Y } from "../../lib/places.js";
import { calm } from "../../dom.js";
import { tip, placeTip } from "../../components/tooltip.js";
import { loadScript, LEAFLET } from "../../components/leaflet.js";
import "./radius.css";

const FLY = 900, FADE = 900; // ms a line takes to reach its alarm, and to fade out after it lands
// speed: days per second while playing, as chosen under "Tempo" (normal: a month per second)
const radius = { el: null, map: null, canvas: null, clock: null, dpr: 1, pts: [], key: "", first: null, days: 0,
  shown: null, queue: [], flights: [], playing: false, day: 0, t: 0, raf: 0, speed: 30 };

// What the tab shows of the map: phase is "start", "playing", "paused" or "done" (the button says what a press
// does next), shown how many alarms are out so far (the first ones; null when not playing, which shows all of
// them), and outside how many lie outside the part of the map in view.
let view = { phase: "start", shown: null, outside: 0 };
const listeners = new Set();
export const radiusView = () => view;
export function radiusSubscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function tell(changes) {
  if (Object.entries(changes).every(([k, v]) => view[k] === v)) return;
  view = { ...view, ...changes };
  listeners.forEach((l) => l());
}

// Hands the map the located alarms (radiusPoints() in lib/places.js) each time the tab is drawn, and draws it
// again if the tab shows. el: the map's box.
export async function radiusUpdate(el, pts) {
  // Only a new selection resets a running playback, not a redraw.
  const key = pts.map((p) => p.r.date + p.r.time + p.ll).join("|");
  if (key !== radius.key) {
    radiusReset();
    Object.assign(radius, { pts, key, first: pts.length ? parseDate(pts[0].r.date) : null, days: pts.length ? pts.at(-1).day : 0 });
  }
  if (!el.offsetWidth) {
    if (radius.playing) radiusPause(); // leaving the view pauses it
    return;
  }
  await loadScript(LEAFLET);
  if (!radius.map) radiusMap(el);
  radius.map.invalidateSize();
  radiusSize();
  radiusDraw();
  radiusOutside();
}

function radiusMap(el) {
  radius.el = el;
  // All alarms lie within about 11 km, so the map stays around the region: zoomed out no further than
  // zoom 9, and no further away than 150 km.
  const map = (radius.map = L.map(el, { zoomSnap: 0.25, minZoom: 9, maxBounds: L.latLng(WACHE).toBounds(300000) }));
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const Clock = L.Control.extend({ options: { position: "topright" }, onAdd: () => L.DomUtil.create("div", "rp-clock") });
  radius.clock = new Clock().addTo(map).getContainer();
  radius.clock.hidden = true;
  // The lines go on a canvas over the map and under its buttons, redrawn whenever the map moves.
  radius.canvas = L.DomUtil.create("canvas", "ra-canvas", el);
  radiusFit("near");
  map.on("resize", () => { radiusSize(); radiusDraw(); });
  map.on("move", () => radiusDraw());
  map.on("moveend", radiusOutside);
  // The canvas can't follow Leaflet's zoom animation, so it steps aside until the zoom ends.
  map.on("zoomanim", () => { radius.canvas.style.visibility = "hidden"; });
  map.on("zoomend", () => { radius.canvas.style.visibility = ""; radiusDraw(); });
  // The page's tooltip shows whatever data-tip the pointer is over, so the map carries the nearest alarm's.
  map.on("mousemove", (e) => {
    const g = radiusNear(e.containerPoint);
    if (g) el.dataset.tip = radiusTip(g); else delete el.dataset.tip;
  });
  map.on("mouseout", () => { delete el.dataset.tip; });
  map.on("click", (e) => {
    const g = radiusNear(e.containerPoint);
    if (g) placeTip(radiusTip(g), e.originalEvent.clientX, e.originalEvent.clientY); else tip.hidden = true;
  });
}

function radiusSize() {
  const { canvas, el } = radius, dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = el.clientWidth * dpr;
  canvas.height = el.clientHeight * dpr;
  canvas.style.width = el.clientWidth + "px";
  canvas.style.height = el.clientHeight + "px";
  radius.dpr = dpr;
}

// "near": Linden, 3 km around the Wache; "all": every alarm of the selection.
export function radiusFit(which) {
  const { map, pts } = radius;
  if (!map) return;
  if (which === "all" && pts.length) map.fitBounds(L.latLngBounds([WACHE, ...pts.map((p) => p.ll)]), { padding: [24, 24] });
  else map.fitBounds(L.latLng(WACHE).toBounds(6000));
}

function radiusOutside() {
  if (!radius.map) return;
  const b = radius.map.getBounds();
  tell({ outside: radius.pts.filter((p) => !b.contains(p.ll)).length });
}

// The alarms at the dot nearest to the pointer (one street shares one spot on the map), oldest first.
function radiusNear(at) {
  const now = performance.now();
  const list = (radius.shown || radius.pts).filter((p) => !radius.shown || !(p.land > now));
  let best = null, bd = 12;
  for (const p of list) {
    const q = radius.map.latLngToContainerPoint(p.ll), d = Math.hypot(q.x - at.x, q.y - at.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best && list.filter((p) => p.ll[0] === best.ll[0] && p.ll[1] === best.ll[1]);
}

function radiusTip(group) {
  const p = group.at(-1), r = p.r;
  const place = `${esc(r.street)}, ${esc(r.district)}`;
  if (group.length === 1) {
    return `<b>${fmtDate(r.date)}${r.timeUnknown ? "" : `, ${r.time} Uhr`}</b><br>${esc(r.name)}${r.event ? ` · ${esc(r.event)}` : ""}<br>${place}<br>${fmtKm(p.km)} Luftlinie`;
  }
  return `<b>${place}</b><br>${einsaetze(group.length)}, ${fmtKm(p.km)} Luftlinie<br>zuletzt ${fmtDate(r.date)}: ${esc(r.name)}`;
}

function radiusDraw(now = performance.now()) {
  const { map, canvas, dpr } = radius;
  if (!map || !canvas.width) return;
  const ctx = canvas.getContext("2d"), W = canvas.width / dpr, H = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement), color = (k) => css.getPropertyValue(k).trim();
  const spoke = color("--accent"), halo = color("--surface"), ink = color("--text"), edge = color("--panel");
  const kindColor = Object.fromEntries(DOT_ORDER.map((k) => [k, color(`--dot-${k}`)]));
  const font = getComputedStyle(document.body).fontFamily;
  const label = (text, x, y, weight = 400) => {
    ctx.font = `${weight} 12px ${font}`;
    ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.strokeStyle = halo; ctx.strokeText(text, x, y);
    ctx.fillStyle = ink; ctx.fillText(text, x, y);
  };
  const o = map.latLngToContainerPoint(WACHE);
  // Pixels per km from the unrounded map position: container points are whole pixels, so 1 km can come out
  // as 0 pixels when zoomed far out.
  const z = map.getZoom(), perKm = map.project(WACHE, z).y - map.project([WACHE[0] + 1 / KM_Y, WACHE[1]], z).y;
  const at = (p) => map.latLngToContainerPoint(p.ll);
  // A slight bend to the right of the direction of travel, so lines to one street don't hide each other.
  const bend = (q) => [(o.x + q.x) / 2 - (q.y - o.y) * 0.18, (o.y + q.y) / 2 + (q.x - o.x) * 0.18];

  // Rings every 1, 2, 5, 10, 20 … km, the smallest step that keeps them at least 50 pixels apart,
  // and only those that cross the visible map (the Wache can be off the map).
  const rings = [];
  if (perKm > 0) {
    let step = 1;
    for (let i = 0; step * perKm < 50; i++) step *= [2, 2.5, 2][i % 3];
    const near = Math.hypot(Math.max(0, -o.x, o.x - W), Math.max(0, -o.y, o.y - H));
    const reach = Math.hypot(Math.max(o.x, W - o.x), Math.max(o.y, H - o.y));
    for (let k = Math.max(1, Math.ceil(near / perKm / step)) * step; k * perKm < reach; k += step) rings.push(k);
  }
  ctx.strokeStyle = ink; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
  for (const k of rings) { ctx.beginPath(); ctx.arc(o.x, o.y, k * perKm, 0, 2 * Math.PI); ctx.stroke(); }
  ctx.setLineDash([]); ctx.globalAlpha = 1;

  const list = radius.shown || radius.pts;
  if (!radius.shown) { // at rest every line faintly, a star around the Wache
    ctx.strokeStyle = spoke; ctx.globalAlpha = 0.2; ctx.lineWidth = 1; ctx.beginPath();
    for (const p of list) { const q = at(p), [mx, my] = bend(q); ctx.moveTo(o.x, o.y); ctx.quadraticCurveTo(mx, my, q.x, q.y); }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.lineWidth = 1; ctx.strokeStyle = edge;
  for (const p of list) {
    if (radius.shown && p.land > now) continue; // still on its way
    const q = at(p);
    ctx.fillStyle = kindColor[p.kind]; ctx.beginPath(); ctx.arc(q.x, q.y, 3.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  }
  // Each new alarm: the line grows from the Wache, then fades while a ring spreads where it landed.
  radius.flights = radius.flights.filter((f) => now - f.t < FLY + FADE);
  for (const f of radius.flights) {
    const age = now - f.t;
    if (age < 0) continue;
    const q = at(f.p), [mx, my] = bend(q), e = 1 - (1 - Math.min(1, age / FLY)) ** 3;
    const pt = (t) => [(1 - t) ** 2 * o.x + 2 * (1 - t) * t * mx + t * t * q.x, (1 - t) ** 2 * o.y + 2 * (1 - t) * t * my + t * t * q.y];
    ctx.globalAlpha = age < FLY ? 0.9 : 0.9 * (1 - (age - FLY) / FADE);
    ctx.strokeStyle = spoke; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(o.x, o.y);
    for (let i = 1; i <= 24; i++) ctx.lineTo(...pt((i / 24) * e));
    ctx.stroke();
    ctx.beginPath();
    if (age < FLY) { ctx.fillStyle = spoke; ctx.arc(...pt(e), 2.5, 0, 2 * Math.PI); ctx.fill(); }
    else { ctx.strokeStyle = kindColor[f.p.kind]; ctx.lineWidth = 2; ctx.arc(q.x, q.y, 3 + ((age - FLY) / FADE) * 14, 0, 2 * Math.PI); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  // ring labels on top of the dots, above each ring (below it where the top is off the map)
  ctx.textAlign = "center";
  for (const k of rings) {
    const y = o.y - k * perKm - 4;
    label(`${k} km`, o.x, y > 14 ? y : o.y + k * perKm + 14);
  }
  // the Wache
  ctx.fillStyle = spoke; ctx.strokeStyle = edge; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.rect(o.x - 6, o.y - 6, 12, 12); ctx.fill(); ctx.stroke();
  ctx.textAlign = "left";
  label("Wache", o.x + 10, o.y + 16, 600);
}

// ---------- Einsatzradius: playback ----------
function radiusReset() {
  cancelAnimationFrame(radius.raf);
  Object.assign(radius, { raf: 0, playing: false, shown: null, queue: [], flights: [] });
  tell({ phase: "start", shown: null });
  if (radius.clock) radius.clock.hidden = true;
}

function radiusPause() {
  radius.playing = false; // lines already on their way still land
  tell({ phase: "paused" });
}

// The button under the tiles: plays, pauses and goes on playing.
export function radiusPlay() {
  if (!radius.map || !radius.pts.length) return;
  if (radius.playing) return radiusPause();
  if (!radius.shown) { // start from the first alarm, a moment before it
    Object.assign(radius, { shown: [], queue: [...radius.pts], flights: [], day: -3 });
  }
  radius.playing = true;
  tell({ phase: "playing", shown: radius.shown.length });
  radius.clock.hidden = false;
  if (!radius.raf) { radius.t = performance.now(); radius.raf = requestAnimationFrame(radiusFrame); }
}

// "Tempo": how many days pass per second while playing.
export function radiusSpeed(days) {
  radius.speed = days;
}

function radiusFrame(now) {
  // at most 0.1 s per frame, so a tab left in the background doesn't jump ahead
  const dt = Math.min(0.1, (now - radius.t) / 1000);
  radius.t = now;
  if (radius.playing) {
    radius.day += dt * radius.speed;
    while (radius.queue.length && radius.queue[0].day <= radius.day) {
      const p = radius.queue.shift(), t = now + (calm() ? 0 : Math.random() * 250);
      p.land = calm() ? 0 : t + FLY;
      radius.shown.push(p);
      if (!calm()) radius.flights.push({ p, t });
    }
    tell({ shown: radius.shown.length });
    const day = Math.max(0, Math.min(radius.days, Math.floor(radius.day)));
    radius.clock.innerHTML = `<b>${fmtDate(isoDate(addDays(radius.first, day)))}</b>${einsaetze(radius.shown.length)}`;
    if (!radius.queue.length && !radius.flights.length) { // all landed: back to the whole picture
      Object.assign(radius, { playing: false, shown: null });
      tell({ phase: "done", shown: null });
      radius.clock.hidden = true;
    }
  }
  radiusDraw(now);
  radius.raf = radius.playing || radius.flights.length ? requestAnimationFrame(radiusFrame) : 0;
}
