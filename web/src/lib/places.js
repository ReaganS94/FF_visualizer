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
