// Liste: every alarm of the selection, newest first, with a search box.
import { useState } from "react";
import { fmtDate } from "../lib/dates.js";
import { einsaetze } from "../lib/text.js";
import { alarmKey, searchAlarms } from "../lib/alarms.js";

const PENDING_TIP = "Noch nicht auf der Website der Feuerwehr. Wird durch den offiziellen Eintrag ersetzt, sobald er dort steht.";

// rows: the alarms chosen with the filters above the tabs.
export default function AlarmList({ rows }) {
  const [text, setText] = useState("");
  const hits = searchAlarms(rows, text);
  // Hand entries fill the gap until the website lists the same alarm, which then replaces them.
  const pending = hits.some((r) => r.manual);
  return (
    <>
      <input type="search" id="q" placeholder="Suchen (Stichwort, Ereignis, Straße, Stadtteil)"
        value={text} onChange={(e) => setText(e.target.value)} />
      <p className="note" id="list-count">
        {`${einsaetze(hits.length)}.`}
        {pending && " Einträge mit „vorläufig“ stehen noch nicht auf der Website der Feuerwehr. Sobald sie dort stehen, ersetzt der offizielle Eintrag sie."}
      </p>
      <div className="table-wrap"><table id="t-list">
        <thead><tr><th>Datum</th><th>Zeit</th><th>Stichwort</th><th>Ereignis</th><th>Straße</th><th>Stadtteil</th></tr></thead>
        <tbody>
          {hits.map((r) => (
            <tr key={alarmKey(r)}>
              {/* the tag sits in the date column, which stays on screen when the table scrolls sideways on a phone */}
              <td>{fmtDate(r.date)}{r.manual && <><br /><span className="tag" data-tip={PENDING_TIP}>vorläufig</span></>}</td>
              <td>{r.timeUnknown ? "?" : r.time}</td>
              <td title={r.name}>{r.keyword}</td>
              <td>{r.event}</td>
              <td>{r.street}</td>
              <td>{r.district}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}
