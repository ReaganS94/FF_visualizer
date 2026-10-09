// Stichworte: the alarms by type and by keyword, as ranked bars.

import { esc, einsaetze } from "../../lib/text.js";
import { topCounts } from "../../lib/count.js";
import { $ } from "../../dom.js";
import { barList } from "../../components/charts.js";

export function renderKeywords(rows) {
  barList($("#c-groups"), topCounts(rows, (r) => r.group).map(([g, list]) => {
    const codes = topCounts(list, (r) => r.base, 4).map(([c, l]) => `${esc(c)} ${esc(l[0].name)} (${l.length})`).join("<br>");
    return { label: g, value: list.length, tip: `<b>${esc(g)}</b> · ${einsaetze(list.length)}<br>${codes}` };
  }));
  barList($("#c-keywords"), topCounts(rows, (r) => r.base).map(([k, list]) => {
    const events = topCounts(list, (r) => r.event, 3).map(([e, l]) => `${esc(e)} (${l.length})`).join("<br>");
    return { label: `${k} · ${list[0].name}`, value: list.length, tip: `<b>${esc(k)}</b> ${esc(list[0].name)} · ${einsaetze(list.length)}<br>${events}` };
  }), { labelWidth: 330 });
}
