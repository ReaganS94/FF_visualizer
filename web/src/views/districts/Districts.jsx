// Stadtteile: the 20 districts with the most alarms, as ranked bars.
import { esc, einsaetze } from "../../lib/text.js";
import { topCounts } from "../../lib/count.js";
import { barList } from "../../components/charts.js";
import Chart from "../../components/Chart.jsx";

// rows: the alarms chosen with the filters above the tabs. The tooltips are HTML, so the names in them are escaped.
export default function Districts({ rows }) {
  const districts = topCounts(rows, (r) => r.district, 20).map(([k, list]) => {
    const streets = topCounts(list, (r) => r.street, 3).map(([e, l]) => `${esc(e)} (${l.length})`).join("<br>");
    return { label: k, value: list.length, tip: `<b>${esc(k)}</b> · ${einsaetze(list.length)}<br>${streets}` };
  });
  return (
    <>
      <h2>Einsätze nach Stadtteil</h2>
      <Chart id="c-districts" draw={(box) => barList(box, districts)} />
    </>
  );
}
