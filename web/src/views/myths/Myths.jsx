// Mythen-Check: one card per myth. The myths, their tests and the verdicts are in lib/myths.js, the results come
// from components/myths.js, which keeps them, and the picture on each card is components/MythPicture.jsx.
import { isoDate, fmtDate } from "../../lib/dates.js";
import { mythVerdict, mythSentence } from "../../lib/myths.js";
import { myths } from "../../components/myths.js";
import MythPicture from "../../components/MythPicture.jsx";
import "./myths.css";

export default function Myths() {
  const { results, first, last, days } = myths();
  return (
    <>
      <p className="note">Stimmt es, dass bei Vollmond mehr los ist? Hier wird jede Behauptung mit den echten Einsätzen geprüft. Verglichen wird immer mit ähnlichen Tagen: gleicher Wochentag, höchstens einen Monat vom selben Datum entfernt, aus allen Jahren. Der graue Balken zeigt, wie stark solche Tage ganz ohne besonderen Grund schwanken. Liegt der blaue Punkt deutlich daneben, steckt wohl mehr dahinter als Zufall.</p>
      <p className="note" id="myths-note">
        {`Gezählt werden ${days.toLocaleString("de-DE")} Tage vom ${fmtDate(isoDate(first))} bis ${fmtDate(isoDate(last))}, ` +
          "ohne Großlagen und ohne Wachbesetzungen."}
      </p>
      <div className="myths" id="c-myths">
        {results.map((m) => {
          const [cls, verdict] = mythVerdict(m.t, m.pick);
          return (
            <article className={`myth ${cls}`} key={m.title}>
              <header><h3>{m.title}</h3><span className="verdict">{verdict}</span></header>
              <MythPicture myth={m} />
              <p>{mythSentence(m)}</p>
              <p className="myth-about">{m.about(m.t)}</p>
            </article>
          );
        })}
      </div>
    </>
  );
}
