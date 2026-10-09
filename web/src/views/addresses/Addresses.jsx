// Stammadressen: streets and places with repeated alarms (which ones: addressGroups in lib/places.js), and
// alarm systems that went off more than once.
import { Fragment } from "react";
import { fmtDate } from "../../lib/dates.js";
import { topCounts } from "../../lib/count.js";
import { alarmKey } from "../../lib/alarms.js";
import { isBMA, isRWM, addressGroups } from "../../lib/places.js";
import "./addresses.css";

// What usually happens there: alarm systems and smoke alarms by the event text, the rest by keyword.
const kind = (r) => (isBMA(r) ? "Brandmeldeanlage" : isRWM(r) ? "Rauchwarnmelder" : r.name.replace(/\s*\(.*\)$/, ""));

// Types with at least two alarms by name (at most three), the rest summed up, so the line adds up to the total.
function what(list) {
  const kinds = topCounts(list, kind, 99);
  const named = kinds.filter(([, l]) => l.length >= 2).slice(0, 3), rest = kinds.slice(named.length);
  const restN = rest.reduce((a, [, l]) => a + l.length, 0);
  return [...named, ...(rest.length === 1 ? rest : [])].map(([k, l]) => `${l.length}× ${k}`)
    .concat(rest.length > 1 ? [named.length ? `${restN}× andere` : `${restN} verschiedene Einsatzarten`] : []).join(" · ");
}

// One street, with its alarms folded underneath. The browser opens and closes the row and React leaves that
// alone, so an open row stays open when the filters change.
function Address({ street, list, max }) {
  const districts = [...new Set(list.map((r) => r.district).filter(Boolean))];
  return (
    <details className="addr">
      <summary>
        <span className="addr-name"><b>{street}</b> <small>{districts.map((d, i) => <Fragment key={d}>{i > 0 && ", "}<span>{d}</span></Fragment>)}</small></span>
        <span className="addr-bar"><i style={{ width: `${((100 * list.length) / max).toFixed(1)}%` }} /></span>
        <span className="addr-n">{list.length}</span>
        <span className="addr-what">{`${what(list)} · zuletzt ${fmtDate(list[0].date)}`}</span>
      </summary>
      <div className="table-wrap"><table><tbody>
        {list.map((r) => (
          <tr key={alarmKey(r)}>
            <td>{r.manual ? <>{`${fmtDate(r.date)} `}<span className="tag">vorläufig</span></> : fmtDate(r.date)}</td>
            <td>{r.timeUnknown ? "?" : r.time}</td>
            <td title={r.name}>{r.keyword}</td>
            <td>{r.event}</td>
          </tr>
        ))}
      </tbody></table></div>
    </details>
  );
}

function AddressList({ id, groups, empty }) {
  return (
    <div className="addr-list" id={id}>
      {groups.length ? groups.map(([street, list]) => <Address key={street} street={street} list={list} max={groups[0][1].length} />)
        : <p className="note">{empty}</p>}
    </div>
  );
}

// rows: the alarms chosen with the filters above the tabs.
export default function Addresses({ rows }) {
  return (
    <>
      <h2>Stammadressen</h2>
      <p className="note">Straßen und Orte mit mindestens drei Einsätzen in der Auswahl. Gezählt wird die Straße, nicht das Haus: An langen Straßen wie der Limmerstraße sind das meist verschiedene Häuser. Antippen zeigt die Einsätze.</p>
      <AddressList id="c-addresses" groups={addressGroups(rows, 3).slice(0, 25)}
        empty="In der Auswahl gibt es keinen Ort mit drei oder mehr Einsätzen." />
      <h2>Brandmeldeanlagen, die öfter auslösen</h2>
      <p className="note">Orte, an denen mindestens zweimal eine Brandmeldeanlage (BMA) ausgelöst hat.</p>
      <AddressList id="c-bma" groups={addressGroups(rows.filter(isBMA), 2)}
        empty="In der Auswahl hat keine Brandmeldeanlage mehr als einmal ausgelöst." />
    </>
  );
}
