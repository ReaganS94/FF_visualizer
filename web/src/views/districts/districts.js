// Stadtteile: the 20 districts with the most alarms, as ranked bars.

import { esc, einsaetze } from "../../lib/text.js";
import { topCounts } from "../../lib/count.js";
import { $ } from "../../dom.js";
import { barList } from "../../components/charts.js";

export function renderDistricts(rows) {
  barList($("#c-districts"), topCounts(rows, (r) => r.district, 20).map(([k, list]) => {
    const streets = topCounts(list, (r) => r.street, 3).map(([e, l]) => `${esc(e)} (${l.length})`).join("<br>");
    return { label: k, value: list.length, tip: `<b>${esc(k)}</b> · ${einsaetze(list.length)}<br>${streets}` };
  }));
}
