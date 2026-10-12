// Where the alarms were: repeat addresses (Stammadressen), the groups and colours of the dot wall, and the
// distance from the Wache (Einsatzradius).
import { MONTHS, parseDate } from "./dates.js";
import { weitere } from "./text.js";
import { topCounts } from "./count.js";

// Fire alarm systems and smoke alarms, by keyword or by the event text.
export const isBMA = (r) => r.base === "o" || /\bBMA\b|Brandmeldeanlage|Brandmelder/i.test(r.event);
export const isRWM = (r) => /RWM|Rauchwarnmelder|Rauchmelder/i.test(r.event);

// Streets with at least `min` alarms, most first: [[street, rows], ...]. Grouped by street alone, since a
// street can cross a district border.
export function addressGroups(rows, min) {
  const by = {};
  for (const r of rows) if (r.street) (by[r.street] ||= []).push(r);
  return Object.entries(by).filter(([, l]) => l.length >= min)
    .sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b, "de"));
}

// The colour of an alarm on the dot wall and the radius map. Three colours at most stay tellable apart
// for everyone; the rarer types share grey ("other").
export const DOT_KINDS = [["brand", "Brand"], ["hilfe", "Technische Hilfe"], ["unwetter", "Unwetter"]];
export const dotKind = (r) => (DOT_KINDS.find(([, g]) => g === r.group) || ["other"])[0];
// Every kind, in the order the dot wall stacks them.
export const DOT_ORDER = ["brand", "hilfe", "unwetter", "other"];

// The dot wall's groups for "month", "hour", "type" or "district": [{label, rows}], the twelve busiest
// districts and the rest together.
const DOT_TOP_DISTRICTS = 12;
export function dotGroups(rows, by) {
  if (by === "month") return MONTHS.map((m, i) => ({ label: m, rows: rows.filter((r) => Number(r.date.slice(5, 7)) === i + 1) }));
  if (by === "hour") {
    const g = Array.from({ length: 24 }, (_, h) => ({ label: String(h), rows: rows.filter((r) => !r.timeUnknown && r.hour === h) }));
    const unknown = rows.filter((r) => r.timeUnknown);
    return unknown.length ? [...g, { label: "?", rows: unknown }] : g;
  }
  if (by === "type") return topCounts(rows, (r) => r.group, 99).map(([g, l]) => ({ label: g, rows: l }));
  const all = topCounts(rows, (r) => r.district, 999);
  const rest = all.slice(DOT_TOP_DISTRICTS).flatMap(([, l]) => l);
  return [...all.slice(0, DOT_TOP_DISTRICTS).map(([d, l]) => ({ label: d, rows: l })),
    ...(rest.length ? [{ label: weitere(all.length - DOT_TOP_DISTRICTS), rows: rest }] : [])];
}

// Where each dot of the dot wall goes in a chart W pixels wide: columns for month and hour (time runs left to
// right), rows for type and district, each group's dots by colour, then oldest first. Returns each alarm's
// place [x, y], the texts to write ({x, y, anchor, count, text}; count: the number of a group's alarms), the
// height and the dots' radius.
export function dotLayout(rows, by, W) {
  const s = W < 600 ? 7 : 9;
  const groups = dotGroups(rows, by);
  for (const g of groups) g.rows.sort((a, b) => DOT_ORDER.indexOf(dotKind(a)) - DOT_ORDER.indexOf(dotKind(b)) || a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const pos = new Map(), labels = [];
  let H;
  if (by === "month" || by === "hour") {
    const cw = W / groups.length, per = Math.max(1, Math.floor((cw - 3) / s)), T = 18, B = 22;
    const high = Math.max(1, ...groups.map((g) => Math.ceil(g.rows.length / per)));
    H = T + high * s + B;
    groups.forEach((g, k) => {
      const x0 = k * cw + (cw - per * s) / 2;
      g.rows.forEach((r, j) => pos.set(r, [x0 + (j % per) * s + s / 2, T + (high - Math.floor(j / per) - 1) * s + s / 2]));
      const top = T + (high - Math.ceil(g.rows.length / per)) * s - 5;
      // a number only above a column wide enough for it; on a narrow chart only every third hour is named
      if (g.rows.length && cw >= 22) labels.push({ x: (k + 0.5) * cw, y: top, anchor: "middle", count: true, text: String(g.rows.length) });
      if (by === "month" || W >= 600 || k % 3 === 0 || g.label === "?") labels.push({ x: (k + 0.5) * cw, y: H - 5, anchor: "middle", text: g.label });
    });
  } else {
    const Lw = Math.min(180, Math.round(W * 0.36)), R = 34, per = Math.max(1, Math.floor((W - Lw - R) / s)), gap = 10;
    let y = 4;
    for (const g of groups) {
      g.rows.forEach((r, j) => pos.set(r, [Lw + (j % per) * s + s / 2, y + Math.floor(j / per) * s + s / 2]));
      labels.push({ x: Lw - 8, y: y + s / 2 + 4, anchor: "end", text: g.label },
        { x: Lw + Math.min(g.rows.length, per) * s + 6, y: y + s / 2 + 4, count: true, text: String(g.rows.length) });
      y += Math.max(1, Math.ceil(g.rows.length / per)) * s + gap;
    }
    H = y;
  }
  return { pos, labels, H, r: s * 0.38 };
}

// The Karte's alarms with a known position ({ p: [lat, lng], date }, in the order given) and how many have none.
// Positions are stored under the spelling as entered; a new spelling of a known street isn't looked up yet.
export function mapPoints(rows, geo) {
  const points = [];
  let missing = 0;
  for (const r of rows) {
    const p = geo[r.geoKey] || geo[`${r.street}|${r.district}`];
    if (p) points.push({ p, date: r.date }); else missing++;
  }
  return { points, missing };
}

// Distances are straight lines on a flat grid around the Wache, which is close enough within a city.
export const WACHE = [52.36847, 9.71195]; // Teichstraße 8 (two map services agree to within 25 m)
export const KM_X = 111.32 * Math.cos((WACHE[0] * Math.PI) / 180), KM_Y = 110.57; // km per degree east and north
export const RADIUS_BINS = [[0, 0.5, "bis 500 m"], [0.5, 1, "0,5–1 km"], [1, 2, "1–2 km"], [2, 3, "2–3 km"], [3, 5, "3–5 km"], [5, Infinity, "über 5 km"]];

// The located alarms, oldest first, with their distance and the day since the first one.
// geo: data/geo.json, "street|district" -> [lat, lon].
export function radiusPoints(rows, geo) {
  const pts = [];
  for (const r of rows) {
    const ll = geo[r.geoKey] || geo[`${r.street}|${r.district}`];
    if (!ll) continue;
    const km = Math.hypot((ll[1] - WACHE[1]) * KM_X, (ll[0] - WACHE[0]) * KM_Y);
    pts.push({ r, ll, km, kind: dotKind(r) });
  }
  pts.reverse();
  const first = pts.length ? parseDate(pts[0].r.date) : null;
  for (const p of pts) p.day = Math.round((parseDate(p.r.date) - first) / 864e5);
  return pts;
}

// What the distances of radiusPoints() add up to: the middle one, how many lie within 2 km, the farthest
// alarm (the first of equals), and how many fall into each RADIUS_BINS ring.
export function radiusSummary(pts) {
  const km = pts.map((p) => p.km).sort((a, b) => a - b);
  return {
    n: km.length,
    median: km.length ? km[Math.floor(km.length / 2)] : null,
    within2: km.filter((k) => k <= 2).length,
    far: pts.reduce((m, p) => (!m || p.km > m.km ? p : m), null),
    bins: RADIUS_BINS.map(([lo, hi]) => km.filter((k) => k >= lo && k < hi).length),
  };
}
