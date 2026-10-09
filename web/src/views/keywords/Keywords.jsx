// Stichworte: the alarms by type and by keyword, as ranked bars.
import { esc, einsaetze } from "../../lib/text.js";
import { topCounts } from "../../lib/count.js";
import { barList } from "../../components/charts.js";
import Chart from "../../components/Chart.jsx";

// rows: the alarms chosen with the filters above the tabs. The tooltips are HTML, so the names in them are escaped.
export default function Keywords({ rows }) {
  const groups = topCounts(rows, (r) => r.group).map(([g, list]) => {
    const codes = topCounts(list, (r) => r.base, 4).map(([c, l]) => `${esc(c)} ${esc(l[0].name)} (${l.length})`).join("<br>");
    return { label: g, value: list.length, tip: `<b>${esc(g)}</b> · ${einsaetze(list.length)}<br>${codes}` };
  });
  const keywords = topCounts(rows, (r) => r.base).map(([k, list]) => {
    const events = topCounts(list, (r) => r.event, 3).map(([e, l]) => `${esc(e)} (${l.length})`).join("<br>");
    return { label: `${k} · ${list[0].name}`, value: list.length, tip: `<b>${esc(k)}</b> ${esc(list[0].name)} · ${einsaetze(list.length)}<br>${events}` };
  });
  return (
    <>
      <h2>Nach Einsatzart</h2>
      <Chart id="c-groups" draw={(box) => barList(box, groups)} />
      <h2>Häufigste Stichworte</h2>
      <p className="note">Stichwort ohne Zusatz (z. B. „b3/manv10“ zählt als „b3“).</p>
      <Chart id="c-keywords" draw={(box) => barList(box, keywords, { labelWidth: 330 })} />
    </>
  );
}
