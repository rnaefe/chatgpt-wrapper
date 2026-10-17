import React, { useContext } from "react";
import { Img, staticFile, useCurrentFrame } from "remotion";
import { Calm, progress } from "./design";
import { colors as c, type as t } from "./constants";

/** A drawn packaging sleeve, not a screenshot of an interface or physical product. */
export function Sleeve() {
  const frame = useCurrentFrame();
  const calm = useContext(Calm);
  const p = calm ? 1 : progress(frame, 8, 68);
  const swap = calm ? 1 : progress(frame, 25, 55);
  return (
    <div style={{ width: 590, height: 360, position: "relative" }}>
      <div style={{ position: "absolute", inset: 0, background: c.ink }} />
      <div
        style={{
          position: "absolute",
          left: 42,
          top: -5,
          width: 506,
          height: 320,
          background: c.background,
          transform: `translateY(${-p * 95}px)`,
          overflow: "hidden",
        }}
      >
        <Img
          src={staticFile("istanbul-cat.png")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: swap,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            padding: 26,
            background: c.surface,
            opacity: 1 - swap,
            fontSize: t.body,
            lineHeight: 1.3,
          }}
        >
          Create a ginger cat
          <br />
          overlooking Istanbul
          <br />
          at sunset.
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: c.muted,
          clipPath: "polygon(0 28%, 50% 74%, 100% 28%, 100% 100%, 0 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: c.ink,
          clipPath: "polygon(0 100%, 0 54%, 50% 82%, 100% 54%, 100% 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 29,
          left: 32,
          color: c.background,
          fontSize: t.body,
          fontWeight: 500,
        }}
      >
        Your task, unwrapped
      </div>
    </div>
  );
}
