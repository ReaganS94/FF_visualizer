// The colour key under a heat chart: a box in each colour, with its label.
import { Fragment } from "react";

export default function Legend({ labels, colors }) {
  return (
    <div className="legend">
      {labels.map((l, i) => (
        // a label and the space before the next box are one piece of text, as the page wrote it before React
        <Fragment key={i}><i style={{ background: colors[i] }} />{i < labels.length - 1 ? `${l} ` : l}</Fragment>
      ))}
    </div>
  );
}
