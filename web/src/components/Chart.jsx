// A chart in a tab that is a React component: React makes the chart's box, and draw(box) draws the chart into
// it with the chart functions in charts.js, each time the tab is drawn, as before the tab moved to React. Those
// functions measure the box and their labels before they settle on a layout, which is simpler to do in the
// finished page than in React, so they stay as they are. React never touches what they draw.
import { useLayoutEffect, useRef } from "react";

export default function Chart({ draw, ...props }) {
  const box = useRef(null);
  useLayoutEffect(() => draw(box.current)); // after every drawing, once the box is on the page
  return <div className="chart" ref={box} {...props} />;
}
