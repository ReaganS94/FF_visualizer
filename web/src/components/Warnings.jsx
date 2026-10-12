// The warnings boxes: at the very top of every tab (place "top") once one warning needs attention, else on
// Übersicht (place "box"), with one quiet line there when there are none. warnings.js loads them.
import { Fragment, useSyncExternalStore } from "react";
import { warnView, warnSubscribe, warnSpan } from "./warnings.js";
import "./warnings.css";

const WARN_MOVE = ["", " shake", " pulse"];
const Icon = () => (
  <span className="warn-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3.5 2.5 20h19L12 3.5z"></path><path d="M12 10v4.5M12 17.6v.1"></path></svg></span>
);
const link = (href, text) => <a href={href} target="_blank" rel="noopener">{text}</a>;
const dwdLink = (text) => link("https://www.dwd.de/DE/wetter/warnungen/warnWetter_node.html", text);
const ninaLink = () => link("https://warnung.bund.de/meldungen", "NINA");

export default function Warnings({ place }) {
  const view = useSyncExternalStore(warnSubscribe, warnView);
  const id = place === "top" ? "warn-top" : "warnings";
  const cls = place === "top" ? "warnings warn-top" : "warnings";
  // nothing until the first answer
  if (!view) return <div className={cls} id={id} role="region" aria-label="Warnungen für Hannover" hidden></div>;

  const { items, dwd, nina, now } = view;
  const top = items.some((w) => w.move);
  const shown = place === "top" ? top : !top; // the box on Übersicht shows even when neither service answered
  const calm = !items.length && (dwd || nina);
  const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const sources = (
    <>
      {dwd && nina ? <>Quellen: {dwdLink("Deutscher Wetterdienst")} (Stadt Hannover) und Warn-App {ninaLink()} (Region Hannover).</>
        : dwd ? <>Quelle: {dwdLink("Deutscher Wetterdienst")} (Stadt Hannover). Andere Warnungen, etwa zu Bränden mit starkem Rauch oder zu Evakuierungen, stehen in der Warn-App {ninaLink()}.</>
        : nina ? <>Quelle: Warn-App {ninaLink()} (Region Hannover), mit den Wetterwarnungen des {dwdLink("Deutschen Wetterdienstes")}.</>
        : <>Die Warnungen konnten gerade nicht geladen werden. Sie stehen beim {dwdLink("Deutschen Wetterdienst")} und in der Warn-App {ninaLink()}.</>}
      {dwd || nina ? ` Stand: ${hm} Uhr.` : ""}
    </>
  );
  const lines = items.length > 0 && items.map((w) => ({ ...w, span: warnSpan(w.onset, w.expires, now) }));
  // The box is drawn anew only when what it says changed, so an opened "Was tun?" stays open over a refresh
  // and the first warning only moves again when something changed.
  const key = JSON.stringify(shown ? lines && lines.map(({ onset, expires, ...w }) => w) : null) + (calm ? nina : "");
  return (
    <div className={cls} id={id} role="region" aria-label="Warnungen für Hannover" hidden={!shown}>
      {shown && (
        <Fragment key={key}>
          {/* Only the first (loudest) warning moves, so several warnings don't turn into a light show. */}
          {lines ? lines.map((w, i) => (
            <div className={`warn l${w.level}${i ? "" : WARN_MOVE[w.move]}`} key={i}>
              <Icon />
              <div className="warn-body">
                <div className="warn-meta"><span className="warn-tag">{w.tag}</span><span>{w.span}</span></div>
                <div className="warn-title">{w.title}</div>
                {w.text && <p className="warn-text">{w.text}</p>}
                {w.todo && <details className="warn-todo"><summary>Was tun?</summary><p>{w.todo}</p></details>}
                {w.nina && <p className="warn-text">Mehr dazu in {ninaLink()}.</p>}
              </div>
            </div>
          )) : calm && <p className="warn-none"><span className="warn-ok" aria-hidden="true">✓</span>{`Für Hannover gibt es gerade keine ${nina ? "amtlichen Warnungen" : "Wetterwarnungen"}.`}</p>}
        </Fragment>
      )}
      {shown && <p className="note">{sources}</p>}
    </div>
  );
}
