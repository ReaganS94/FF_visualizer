// A myth's picture: the blue dot for the myth's days, the grey band where similar days land by chance and the line
// at their average, with an axis and a legend. On the Mythen-Check and in the quiz.
import { mythMax } from "../lib/myths.js";
import "./myths.css";

const dec = (x) => x.toFixed(2).replace(".", ",");

// myth: a myth with its test (t), from lib/myths.js's mythResults.
export default function MythPicture({ myth: m }) {
  const { t } = m;
  const max = mythMax(t);
  const x = (v) => `${((100 * v) / max).toFixed(2)}%`;
  return (
    <>
      <div className="myth-strip" role="img" aria-label={`${m.label}: ${dec(t.avg)} pro Tag. ${m.cmp}: zufällig ${dec(t.lo)} bis ${dec(t.hi)}.`}>
        <span className="myth-band" style={{ left: x(t.lo), width: `calc(${x(t.hi - t.lo)} + 2px)` }} />
        <span className="myth-base" style={{ left: x(t.base) }} />
        <span className="myth-dot" style={{ left: x(t.avg) }} />
      </div>
      <div className="myth-axis">
        {[0, max / 2, max].map((v, i) => <span key={i} style={{ left: x(v) }}>{String(v).replace(".", ",")}</span>)}
      </div>
      <ul className="myth-legend">
        <li><i className="k-dot" />{`${m.label}: `}<b>{dec(t.avg)}</b>{" Einsätze pro Tag"}</li>
        <li><i className="k-band" />{`${m.cmp}: `}<b>{dec(t.base)}</b>{`, durch Zufall zwischen ${dec(t.lo)} und ${dec(t.hi)}`}</li>
      </ul>
    </>
  );
}
