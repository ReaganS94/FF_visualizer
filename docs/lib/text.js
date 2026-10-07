// Small helpers for the text on the page.

// Makes text from the data safe to put into the page's HTML.
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// "1 Einsatz", "2 Einsätze" (German numbers with a thousands dot), "mit 2 Einsätzen" with dative = true
export const einsaetze = (n, dative = false) => `${n.toLocaleString("de-DE")} ${n === 1 ? "Einsatz" : dative ? "Einsätzen" : "Einsätze"}`;
export const weitere = (n) => `${n} ${n === 1 ? "weiterer" : "weitere"}`;
