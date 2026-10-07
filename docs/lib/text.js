// Small helpers for the text on the page.

// Makes text from the data safe to put into the page's HTML.
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// "1 Einsatz", "2 Einsätze" (German numbers with a thousands dot), "mit 2 Einsätzen" with dative = true
export const einsaetze = (n, dative = false) => `${n.toLocaleString("de-DE")} ${n === 1 ? "Einsatz" : dative ? "Einsätzen" : "Einsätze"}`;
export const weitere = (n) => `${n} ${n === 1 ? "weiterer" : "weitere"}`;

// A distance: metres to the nearest 10 below 1 km, else km with one decimal ("1,2 km").
export function fmtKm(k) {
  const m = Math.round(k * 100) * 10;
  return m < 1000 ? `${m} m` : `${k.toFixed(1).replace(".", ",")} km`;
}
