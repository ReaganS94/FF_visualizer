// The colour key under a heat chart in a tab that is a React component: a box in each colour, with its label.
// It draws the same as legend() in charts.js, which the tabs that are not React components yet still use.
import { Fragment } from "react";

export default function Legend({ labels, colors }) {
  return (
    <div className="legend">
      {labels.map((l, i) => (
        // a label and the space before the next box are one piece of text, as in legend()
        <Fragment key={i}><i style={{ background: colors[i] }} />{i < labels.length - 1 ? `${l} ` : l}</Fragment>
      ))}
    </div>
  );
}
