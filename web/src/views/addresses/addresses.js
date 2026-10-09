// Stammadressen: streets and places with repeated alarms (which ones: addressGroups in lib/places.js), and
// alarm systems that went off more than once.

import { fmtDate } from "../../lib/dates.js";
import { esc } from "../../lib/text.js";
import { topCounts } from "../../lib/count.js";
import { isBMA, isRWM, addressGroups } from "../../lib/places.js";
import { $ } from "../../dom.js";
import "./addresses.css";

function addressList(el, groups, empty) {
  if (!groups.length) { el.innerHTML = `<p class="note">${empty}</p>`; return; }
  const open = new Set([...el.querySelectorAll("details[open]")].map((d) => d.dataset.k)); // stays open across redraws
  const max = groups[0][1].length;
  el.innerHTML = groups.map(([street, list]) => {
    const districts = [...new Set(list.map((r) => r.district).filter(Boolean))].map((d) => `<span>${esc(d)}</span>`).join(", ");
    // What usually happens there: alarm systems and smoke alarms by the event text, the rest by keyword.
    const kind = (r) => (isBMA(r) ? "Brandmeldeanlage" : isRWM(r) ? "Rauchwarnmelder" : r.name.replace(/\s*\(.*\)$/, ""));
    // Types with at least two alarms by name (at most three), the rest summed up, so the line adds up to the total.
    const kinds = topCounts(list, kind, 99);
    const named = kinds.filter(([, l]) => l.length >= 2).slice(0, 3), rest = kinds.slice(named.length);
    const restN = rest.reduce((a, [, l]) => a + l.length, 0);
    const what = [...named, ...(rest.length === 1 ? rest : [])].map(([k, l]) => `${l.length}× ${esc(k)}`)
      .concat(rest.length > 1 ? [named.length ? `${restN}× andere` : `${restN} verschiedene Einsatzarten`] : []).join(" · ");
    const alarms = list.map((r) => `<tr><td>${fmtDate(r.date)}${r.manual ? ' <span class="tag">vorläufig</span>' : ""}</td>` +
      `<td>${r.timeUnknown ? "?" : esc(r.time)}</td><td title="${esc(r.name)}">${esc(r.keyword)}</td><td>${esc(r.event)}</td></tr>`).join("");
    return `<details class="addr" data-k="${esc(street)}"${open.has(street) ? " open" : ""}><summary>` +
      `<span class="addr-name"><b>${esc(street)}</b> <small>${districts}</small></span>` +
      `<span class="addr-bar"><i style="width:${((100 * list.length) / max).toFixed(1)}%"></i></span>` +
      `<span class="addr-n">${list.length}</span>` +
      `<span class="addr-what">${what} · zuletzt ${fmtDate(list[0].date)}</span></summary>` +
      `<div class="table-wrap"><table><tbody>${alarms}</tbody></table></div></details>`;
  }).join("");
}

export function renderAddresses(rows) {
  addressList($("#c-addresses"), addressGroups(rows, 3).slice(0, 25), "In der Auswahl gibt es keinen Ort mit drei oder mehr Einsätzen.");
  addressList($("#c-bma"), addressGroups(rows.filter(isBMA), 2), "In der Auswahl hat keine Brandmeldeanlage mehr als einmal ausgelöst.");
}
