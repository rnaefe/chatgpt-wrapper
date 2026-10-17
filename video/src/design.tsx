import React, { createContext, useContext } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { loadVariableFont } from "@remotion/google-fonts/TikTokSans";
import { loadFont as loadCodeFont } from "@remotion/google-fonts/JetBrainsMono"; // taste-skill-ignore: used only for literal source code and JSON in pre elements.
import { colors as c, type as t } from "./constants";

export const sans = loadVariableFont("oblique 0deg 6deg", {
  subsets: ["latin"],
}).fontFamily;
export const codeFace = loadCodeFont("normal", {
  weights: ["400"],
  subsets: ["latin"],
}).fontFamily;
export const Calm = createContext(false);
const ease = Easing.bezier(0.23, 1, 0.32, 1);
export function progress(frame: number, from = 0, to = 24) {
  return interpolate(frame, [from, to], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
}
export function Reveal({
  children,
  delay = 0,
  style = {},
}: {
  children: React.ReactNode;
  delay?: number;
  style?: React.CSSProperties;
}) {
  const frame = useCurrentFrame();
  const calm = useContext(Calm);
  const p = progress(frame, delay, delay + 24);
  return (
    <div
      style={{
        ...style,
        opacity: p,
        clipPath: calm ? undefined : `inset(${(1 - p) * 100}% 0 0 0)`,
        transform: calm ? undefined : `translateY(${(1 - p) * 20}px)`,
      }}
    >
      {children}
    </div>
  );
}
export function Stage({
  children,
  inverse = false,
  surface = false,
  note,
  brand = true,
}: {
  children: React.ReactNode;
  inverse?: boolean;
  surface?: boolean;
  note: string;
  brand?: boolean;
}) {
  return (
    <AbsoluteFill
      style={{
        background: inverse ? c.ink : surface ? c.surface : c.background,
        color: inverse ? c.background : c.ink,
        fontFamily: sans,
        fontWeight: 400,
        padding: "52px 64px",
        overflow: "hidden",
      }}
    >
      <style>{"* { box-sizing: border-box; }"}</style>
      {brand ? (
        <div
          style={{
            position: "absolute",
            top: 48,
            left: 64,
            fontSize: t.body,
            fontWeight: 800,
            fontVariationSettings: '"wdth" 150, "wght" 800',
          }}
        >
          wrapper
        </div>
      ) : null}
      {children}
      <p
        style={{
          position: "absolute",
          left: 64,
          bottom: 30,
          fontSize: t.small,
          lineHeight: 1.35,
          margin: 0,
          maxWidth: 1480,
          opacity: 0.85,
        }}
      >
        {note}
      </p>
    </AbsoluteFill>
  );
}
export function Headline({
  children,
  style = {},
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <h1
      style={{
        fontSize: t.head,
        fontWeight: 800,
        fontVariationSettings: '"wdth" 150, "wght" 800, "slnt" 0',
        lineHeight: 0.98,
        letterSpacing: "-.02em",
        margin: 0,
        ...style,
      }}
    >
      {children}
    </h1>
  );
}
export function Body({
  children,
  style = {},
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <p
      style={{
        fontSize: t.body,
        lineHeight: 1.4,
        margin: 0,
        maxWidth: 1000,
        ...style,
      }}
    >
      {children}
    </p>
  );
}
