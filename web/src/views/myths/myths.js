// Mythen-Check: one card per myth. The myths and their tests are in lib/myths.js, the results and pictures
// in components/myths.js; this draws the view.

import { isoDate, fmtDate } from "../../lib/dates.js";
import { esc } from "../../lib/text.js";
import { $ } from "../../dom.js";
import { myths, mythParts } from "../../components/myths.js";
import "./myths.css";

export function renderMyths() {
  const { results, first, last, days } = myths();
  $("#myths-note").textContent = `Gezählt werden ${days.toLocaleString("de-DE")} Tage vom ${fmtDate(isoDate(first))} bis ${fmtDate(isoDate(last))}, ` +
    "ohne Großlagen und ohne Wachbesetzungen.";
  $("#c-myths").innerHTML = results.map((m) => {
    const { cls, verdict, picture, sentence } = mythParts(m);
    return `<article class="myth ${cls}"><header><h3>${m.title}</h3><span class="verdict">${verdict}</span></header>` +
      `${picture}<p>${sentence}</p><p class="myth-about">${esc(m.about(m.t))}</p></article>`;
  }).join("");
}
