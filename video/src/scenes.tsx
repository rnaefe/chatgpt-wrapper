import React, { useContext } from "react";
import { Img, staticFile, useCurrentFrame } from "remotion";
import session from "../public/session.json";
import { colors as c, type as t } from "./constants";
import {
  Body,
  Calm,
  codeFace,
  Headline,
  progress,
  Reveal,
  Stage,
} from "./design";
import { Sleeve } from "./sleeve";

export function Intro() {
  return (
    <Stage
      brand={false}
      note="Packaging illustration using an actual Wrapper-generated image. Independent, experimental project."
    >
      <div style={{ position: "absolute", left: 665, top: 185 }}>
        <Sleeve />
      </div>
      <Reveal
        delay={4}
        style={{
          position: "absolute",
          top: 565,
          left: 0,
          right: 0,
          textAlign: "center",
        }}
      >
        <Headline
          style={{
            fontSize: t.display,
            lineHeight: 1,
            letterSpacing: "-.01em",
          }}
        >
          wrapper
        </Headline>
      </Reveal>
      <Reveal
        delay={8}
        style={{
          position: "absolute",
          top: 855,
          left: 0,
          right: 0,
          textAlign: "center",
        }}
      >
        <Body style={{ maxWidth: "none", fontSize: t.lead }}>
          Your ChatGPT session, inside your MCP client.
        </Body>
      </Reveal>
    </Stage>
  );
}
export function Workflow() {
  const frame = useCurrentFrame();
  const calm = useContext(Calm);
  const gather = calm ? 1 : progress(frame, 12, 60);
  const release = calm ? 1 : progress(frame, 70, 110);
  const pieces = [
    {
      name: "Objective",
      text: "Write a TypeScript clamp function",
      x: 0,
      y: 0,
    },
    { name: "Output", text: "Complete source code", x: 75, y: 166 },
    {
      name: "Constraints",
      text: "Preserve code and report limits",
      x: 20,
      y: 332,
    },
  ];
  return (
    <Stage note="Conceptual task envelope. A durable SQLite queue runs one browser task at a time.">
      <Reveal style={{ position: "absolute", left: 64, top: 150, width: 900 }}>
        <Headline>
          Wrapped
          <br />
          with context
        </Headline>
      </Reveal>
      <Body style={{ position: "absolute", left: 64, top: 450, width: 660 }}>
        Your objective and constraints travel together. Wrapper returns the
        resulting artifact to your coding client.
      </Body>
      <div
        style={{
          position: "absolute",
          left: 1000,
          top: 180,
          width: 800,
          height: 580,
        }}
      >
        {pieces.map((piece, index) => (
          <div
            key={piece.name}
            style={{
              position: "absolute",
              left: piece.x * (1 - gather),
              top: piece.y * (1 - gather) + index * 17,
              background: index === 2 ? c.ink : c.surface,
              color: index === 2 ? c.background : c.ink,
              width: 710,
              padding: "34px 40px",
              height: 170,
              transform: calm
                ? undefined
                : `rotate(${(1 - gather) * (index - 1) * 4}deg) translateY(${-release * index * 28}px)`,
              opacity: Math.max(0, 1 - release * 2),
            }}
          >
            <div style={{ fontSize: t.body, fontWeight: 800 }}>
              {piece.name}
            </div>
            <div style={{ fontSize: t.body, marginTop: 18 }}>{piece.text}</div>
          </div>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: 1000,
          top: 210,
          width: 760,
          minHeight: 500,
          padding: 40,
          background: c.ink,
          color: c.background,
          opacity: release,
        }}
      >
        <div style={{ fontSize: t.lead, fontWeight: 500 }}>Task envelope</div>
        <pre
          style={{
            fontFamily: codeFace,
            fontSize: 26,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            margin: "30px 0 0",
          }}
        >
          {JSON.stringify(
            {
              capability: "code.generate",
              objective: "Write a TypeScript clamp function",
              acceptanceCriteria: ["Return complete source code"],
            },
            null,
            2,
          )}
        </pre>
      </div>
      <Reveal delay={75} style={{ position: "absolute", left: 1000, top: 750 }}>
        <Body>Submit once. Wait for the result.</Body>
      </Reveal>
    </Stage>
  );
}
export function Code() {
  const frame = useCurrentFrame();
  const calm = useContext(Calm);
  const reveal = calm ? 1 : progress(frame, 25, 85);
  const code = session.task[3];
  return (
    <Stage
      inverse
      note="Actual recorded provider result, 17 Oct 2026. Rendered presentation. Timing varies; waiting shortened."
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 125,
          width: 900,
          padding: "55px 64px",
        }}
      >
        <Reveal>
          <Headline>Ask for code</Headline>
        </Reveal>
        <Body style={{ marginTop: 45, maxWidth: 670 }}>
          Write a TypeScript clamp function and return the complete source.
        </Body>
        <pre
          style={{
            fontFamily: codeFace,
            fontSize: 26,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            marginTop: 75,
            width: 680,
          }}
        >
          {JSON.stringify(
            {
              capability: "code.generate",
              objective: "Return a TypeScript clamp function",
            },
            null,
            2,
          )}
        </pre>
        <Body style={{ marginTop: 80 }}>
          Captured run: {session.seconds} seconds.
        </Body>
      </div>
      <div
        style={{
          position: "absolute",
          left: 960,
          top: 0,
          bottom: 100,
          right: 0,
          background: c.surface,
          color: c.ink,
          padding: "180px 64px",
          clipPath: calm ? undefined : `inset(0 ${(1 - reveal) * 100}% 0 0)`,
        }}
      >
        <Headline>Get the source</Headline>
        <pre
          style={{
            fontFamily: codeFace,
            fontSize: 30,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            marginTop: 85,
            maxWidth: 800,
          }}
        >
          {code}
        </pre>
        <Body
          style={{ position: "absolute", bottom: 150, left: 64, width: 780 }}
        >
          The captured source is preserved. Review it before applying it.
        </Body>
      </div>
    </Stage>
  );
}
export function ImageResult() {
  const frame = useCurrentFrame();
  const calm = useContext(Calm);
  const open = calm ? 1 : progress(frame, 5, 45);
  const fit = calm ? 1 : progress(frame, 65, 130);
  return (
    <Stage note="Actual Wrapper-generated artifact. Preview, metadata and download are presented as an editorial layout.">
      <Reveal style={{ position: "absolute", left: 64, top: 160, width: 670 }}>
        <Headline>
          Keep the
          <br />
          image
        </Headline>
      </Reveal>
      <Body style={{ position: "absolute", left: 64, top: 445, width: 590 }}>
        Generated through Wrapper.
        <br />
        Delivered with a PNG file and chat-ready display links.
      </Body>
      <div
        style={{
          position: "absolute",
          left: 865,
          top: 125,
          width: 850,
          height: 720,
          overflow: "hidden",
          background: c.surface,
          clipPath: calm ? undefined : `inset(0 0 ${(1 - open) * 100}% 0)`,
        }}
      >
        <Img
          src={staticFile("istanbul-cat.png")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            transform: calm ? undefined : `scale(${1.35 - fit * 0.35})`,
          }}
        />
      </div>
      <Body
        style={{ position: "absolute", left: 865, top: 870, fontSize: t.small }}
      >
        Istanbul at sunset. Actual generated output.
      </Body>
    </Stage>
  );
}
const capabilities = [
  ["code.generate", "Write complete code"],
  ["code.review", "Review for actionable defects"],
  ["reason.analyze", "Work through a decision"],
  ["image.generate", "Create an image"],
  ["image.analyze", "Describe, compare, read text"],
  ["image.edit", "Edit an existing image"],
];
export function Capabilities() {
  const frame = useCurrentFrame();
  const calm = useContext(Calm);
  const selected = calm ? 3 : Math.min(5, Math.floor(frame / 30));
  return (
    <Stage
      surface
      note="Development capabilities. Image analysis/editing have fixture coverage; live access depends on provider UI."
    >
      <Reveal style={{ position: "absolute", top: 160, left: 64, width: 600 }}>
        <Headline>
          Six task
          <br />
          types
        </Headline>
      </Reveal>
      <Body style={{ position: "absolute", top: 440, left: 64, width: 590 }}>
        Six task types share the same queue, saved session and artifact
        delivery.
      </Body>
      <div style={{ position: "absolute", left: 810, top: 140, right: 64 }}>
        {capabilities.map(([name, description], index) => (
          <div
            key={name}
            style={{
              padding: "18px 30px",
              background: index === selected ? c.ink : "transparent",
              color: index === selected ? c.background : c.ink,
              minHeight: 125,
            }}
          >
            <div style={{ fontSize: t.lead, fontWeight: 500 }}>{name}</div>
            {index === selected ? (
              <div style={{ fontSize: t.body, marginTop: 8 }}>
                {description}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Stage>
  );
}
export function Speed() {
  return (
    <Stage note="12 sequential fixture tasks. Median queue + validation + persistence. Browser and provider time excluded.">
      <Reveal style={{ position: "absolute", left: 64, top: 145 }}>
        <Headline>A queue that wakes</Headline>
      </Reveal>
      <div
        style={{
          position: "absolute",
          left: 64,
          top: 350,
          width: 900,
          height: 590,
          background: c.ink,
          color: c.background,
          padding: 45,
        }}
      >
        <Reveal delay={5}>
          <div
            style={{
              fontSize: t.display,
              fontWeight: 800,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
            }}
          >
            1.7<span style={{ fontSize: t.lead, marginLeft: 20 }}>ms</span>
          </div>
        </Reveal>
        <Body
          style={{ position: "absolute", bottom: 42, left: 45, width: 760 }}
        >
          Median with event-driven scheduling.
        </Body>
      </div>
      <div
        style={{
          position: "absolute",
          left: 980,
          top: 460,
          width: 435,
          height: 480,
          background: c.surface,
          padding: 38,
        }}
      >
        <Reveal delay={8}>
          <div style={{ fontSize: t.head, fontWeight: 800, lineHeight: 1 }}>
            244
          </div>
          <Body>milliseconds before</Body>
        </Reveal>
        <Body
          style={{ position: "absolute", bottom: 38, left: 38, width: 340 }}
        >
          Previous 250 ms polling interval.
        </Body>
      </div>
      <div
        style={{
          position: "absolute",
          left: 1431,
          top: 590,
          width: 425,
          height: 350,
          background: c.ink,
          color: c.background,
          padding: 38,
        }}
      >
        <Reveal delay={11}>
          <div style={{ fontSize: t.head, fontWeight: 800, lineHeight: 1 }}>
            12
          </div>
          <Body>local samples</Body>
        </Reveal>
        <Body
          style={{
            position: "absolute",
            bottom: 38,
            left: 38,
            width: 340,
            fontSize: t.small,
          }}
        >
          Provider generation
          <br />
          is not included.
        </Body>
      </div>
    </Stage>
  );
}
export function Outro() {
  return (
    <Stage
      inverse
      brand={false}
      note="Node.js 24+ and your ChatGPT account. Manual sign-in; provider verification can interrupt work."
    >
      <Body
        style={{ position: "absolute", left: 64, top: 90, fontSize: t.lead }}
      >
        Build from source.
      </Body>
      <Reveal style={{ position: "absolute", left: 64, right: 64, top: 235 }}>
        <Headline style={{ fontSize: t.display }}>
          Clone
          <br />
          Wrapper
        </Headline>
      </Reveal>
      <Reveal delay={5} style={{ position: "absolute", left: 64, top: 805 }}>
        <Body style={{ fontSize: t.lead, maxWidth: 1800 }}>
          github.com/rnaefe/chatgpt-wrapper
        </Body>
        <Body style={{ marginTop: 25, maxWidth: 1800 }}>
          pnpm install → pnpm build → pnpm connect
        </Body>
      </Reveal>
    </Stage>
  );
}
