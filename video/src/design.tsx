import React, { createContext, useContext } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { loadFont as loadSans } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { colors as c } from "./constants";

export const sans = loadSans("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin"],
}).fontFamily;
export const mono = loadMono("normal", {
  weights: ["400", "500"],
  subsets: ["latin"],
}).fontFamily;
export const Calm = createContext(false);
const ease = Easing.bezier(0.23, 1, 0.32, 1);
export function progress(frame: number, from = 0, to = 18) {
  return interpolate(frame, [from, to], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
}
export function Rise({
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
  const p = progress(frame, delay, delay + 18);
  return (
    <div
      style={{
        ...style,
        opacity: p,
        transform: calm ? undefined : `translateY(${(1 - p) * 32}px)`,
      }}
    >
      {children}
    </div>
  );
}
export function Tag({
  children,
  light = false,
}: {
  children: React.ReactNode;
  light?: boolean;
}) {
  return (
    <div
      style={{
        fontFamily: mono,
        fontSize: 18,
        letterSpacing: 2,
        color: light ? c.background : c.accent,
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}
export function Stage({
  children,
  index,
  title,
  seconds,
  light = false,
  note,
}: {
  children: React.ReactNode;
  index: number;
  title: string;
  seconds: number;
  light?: boolean;
  note: string;
}) {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, 5, seconds * 30 - 7, seconds * 30],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <AbsoluteFill
      style={{
        background: light ? c.accent : c.background,
        color: light ? c.background : c.text,
        fontFamily: sans,
        padding: "58px 88px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.09,
          backgroundImage: `linear-gradient(${light ? "#17210d" : c.line} 1px,transparent 1px),linear-gradient(90deg,${light ? "#17210d" : c.line} 1px,transparent 1px)`,
          backgroundSize: "80px 80px",
        }}
      />
      <div style={{ position: "relative", height: "100%", opacity }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: mono,
            fontSize: 21,
            letterSpacing: 2,
          }}
        >
          <span
            style={{
              fontFamily: sans,
              fontWeight: 700,
              fontSize: 28,
              letterSpacing: -1,
            }}
          >
            ▰ wrapper
            <span style={{ color: light ? "#58712b" : c.accent }}>.</span>
          </span>
          <span style={{ color: light ? "#384b19" : c.muted, fontSize: 17 }}>
            0{index} / {title.toUpperCase()}
          </span>
        </div>
        {children}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "end",
            fontFamily: mono,
            fontSize: 16,
            color: light ? "#384b19" : c.muted,
          }}
        >
          <span style={{ maxWidth: 1200 }}>{note}</span>
          <span>rnaefe / chatgpt-wrapper</span>
        </div>
      </div>
    </AbsoluteFill>
  );
}
export function Headline({
  children,
  size = 88,
}: {
  children: React.ReactNode;
  size?: number;
}) {
  return (
    <h1
      style={{
        fontSize: size,
        lineHeight: 1.02,
        letterSpacing: -size * 0.055,
        fontWeight: 700,
        margin: "22px 0 28px",
      }}
    >
      {children}
    </h1>
  );
}
export function Panel({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div
      style={{
        background: c.panel,
        border: `1px solid ${c.line}`,
        borderRadius: 22,
        overflow: "hidden",
        boxShadow: "0 30px 100px #0005",
      }}
    >
      <div
        style={{
          height: 56,
          padding: "0 28px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: `1px solid ${c.line}`,
        }}
      >
        {["#ff756b", "#f9c85d", "#a7d975"].map((color) => (
          <span
            key={color}
            style={{
              width: 10,
              height: 10,
              borderRadius: 10,
              background: color,
            }}
          />
        ))}
        <span
          style={{
            fontFamily: mono,
            fontSize: 16,
            color: c.muted,
            marginLeft: 14,
          }}
        >
          {label}
        </span>
      </div>
      <div style={{ padding: 30 }}>{children}</div>
    </div>
  );
}
