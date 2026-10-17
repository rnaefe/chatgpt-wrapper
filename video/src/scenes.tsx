import React, { useContext } from "react";
import { Img, staticFile, useCurrentFrame } from "remotion";
import session from "../public/session.json";
import { colors as c } from "./constants";
import {
  Calm,
  Headline,
  mono,
  Panel,
  progress,
  Rise,
  Stage,
  Tag,
} from "./design";

export function Intro() {
  const frame = useCurrentFrame();
  const calm = useContext(Calm);
  return (
    <Stage
      index={1}
      title="Why I built it"
      seconds={4}
      note="A literal browser wrapper, not an official ChatGPT API integration."
    >
      <Rise style={{ marginTop: 125 }}>
        <Tag>I hit my Codex usage limit.</Tag>
      </Rise>
      <Rise delay={3}>
        <Headline size={144}>
          SO I WRAPPED
          <br />
          <span style={{ color: c.accent }}>CHATGPT.</span>
        </Headline>
      </Rise>
      <Rise delay={6}>
        <p
          style={{
            fontSize: 32,
            color: c.muted,
            maxWidth: 1260,
            lineHeight: 1.4,
          }}
        >
          Literally. Playwright for the browser.
          <br />
          MCP for the coding tools.
        </p>
      </Rise>
      <div
        style={{
          position: "absolute",
          right: 48,
          top: 112,
          fontFamily: mono,
          fontSize: 160,
          color: c.accent,
          opacity: 0.16,
          transform: calm
            ? undefined
            : `translateY(${Math.sin(frame / 25) * 8}px)`,
        }}
      >
        ↗
      </div>
    </Stage>
  );
}
export function Workflow() {
  const frame = useCurrentFrame();
  const calm = useContext(Calm);
  const nodes = ["MCP CLIENT", "LOCAL QUEUE", "CHATGPT", "YOUR RESULT"];
  return (
    <Stage
      index={2}
      title="The workflow"
      seconds={6}
      note="Conceptual flow. Saved browser session; one provider task at a time."
    >
      <Rise style={{ marginTop: 80 }}>
        <Tag>One local bridge.</Tag>
        <Headline>
          Keep the work
          <br />
          in your coding flow.
        </Headline>
      </Rise>
      <div
        style={{
          display: "flex",
          gap: 20,
          alignItems: "center",
          marginTop: 65,
        }}
      >
        {nodes.map((node, index) => (
          <React.Fragment key={node}>
            <Rise delay={index * 2} style={{ width: 370 }}>
              <div
                style={{
                  background: index === 2 ? c.accent : c.panel,
                  color: index === 2 ? c.background : c.text,
                  padding: "44px 24px",
                  borderRadius: 20,
                  border: `1px solid ${c.line}`,
                }}
              >
                <div style={{ fontFamily: mono, fontSize: 18, opacity: 0.6 }}>
                  0{index + 1}
                </div>
                <div style={{ fontWeight: 600, fontSize: 28, marginTop: 36 }}>
                  {node}
                </div>
              </div>
            </Rise>
            {index < 3 ? (
              <span style={{ color: c.accent, fontSize: 36 }}>→</span>
            ) : null}
          </React.Fragment>
        ))}
      </div>
      <div
        style={{
          marginTop: 50,
          height: 3,
          background: c.line,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 140,
            height: 3,
            background: c.accent,
            transform: `translateX(${calm ? 800 : ((frame * 12) % 1800) - 140}px)`,
          }}
        />
      </div>
    </Stage>
  );
}
export function Code() {
  const frame = useCurrentFrame();
  const code = session.task.slice(3, 4).join("\n");
  const visible = Math.floor(progress(frame, 18, 70) * code.length);
  return (
    <Stage
      index={3}
      title="Actual captured output"
      seconds={8}
      note="Recorded provider result, 17 Oct 2026. Rendered presentation; waiting shortened."
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "600px 1fr",
          gap: 70,
          marginTop: 100,
        }}
      >
        <div>
          <Rise>
            <Tag>code.generate</Tag>
            <Headline size={94}>
              A prompt in.
              <br />
              Code back.
            </Headline>
          </Rise>
          <Rise delay={4}>
            <p style={{ fontSize: 27, color: c.muted, lineHeight: 1.5 }}>
              A TypeScript clamp function.
              <br />
              Source preserved in a fenced block.
            </p>
            <div
              style={{
                fontFamily: mono,
                fontSize: 66,
                color: c.accent,
                marginTop: 50,
              }}
            >
              {session.seconds}
              <span style={{ fontSize: 30 }}>s</span>
            </div>
            <div style={{ fontSize: 19, color: c.muted, marginTop: 10 }}>
              This captured run. Timing varies.
            </div>
          </Rise>
        </div>
        <Rise delay={5}>
          <Panel label="CAPTURED MCP RESPONSE / TYPESCRIPT">
            <div
              style={{
                fontFamily: mono,
                fontSize: 23,
                color: c.muted,
                paddingBottom: 26,
                borderBottom: `1px solid ${c.line}`,
              }}
            >
              submit_task → wait_task → result
            </div>
            <pre
              style={{
                fontFamily: mono,
                fontSize: 29,
                lineHeight: 1.7,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                minHeight: 270,
                color: c.text,
              }}
            >
              {code.slice(0, visible)}
              <span style={{ color: c.accent }}>▍</span>
            </pre>
            <div
              style={{
                fontFamily: mono,
                color: c.accent,
                fontSize: 20,
                opacity: progress(frame, 85, 100),
              }}
            >
              ✓ Actual source verified
            </div>
          </Panel>
        </Rise>
      </div>
    </Stage>
  );
}
export function ImageResult() {
  const frame = useCurrentFrame();
  const calm = useContext(Calm);
  return (
    <Stage
      index={4}
      title="Actual generated artifact"
      seconds={6}
      note="Image generated through Wrapper. File export and chat-link delivery shown conceptually."
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "520px 1fr",
          gap: 70,
          marginTop: 95,
        }}
      >
        <Rise>
          <Tag>image.generate</Tag>
          <Headline size={100}>
            Make it.
            <br />
            See it.
            <br />
            <span style={{ color: c.accent }}>Save it.</span>
          </Headline>
          <p style={{ fontSize: 26, lineHeight: 1.5, color: c.muted }}>
            A real image artifact,
            <br />
            with a preview and a local file.
          </p>
          <div
            style={{
              fontFamily: mono,
              fontSize: 20,
              color: c.accent,
              marginTop: 42,
            }}
          >
            PNG / DISPLAY / DOWNLOAD ↗
          </div>
        </Rise>
        <Rise delay={3}>
          <div
            style={{
              height: 640,
              borderRadius: 24,
              overflow: "hidden",
              position: "relative",
              border: `1px solid ${c.line}`,
            }}
          >
            <Img
              src={staticFile("istanbul-cat.png")}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: calm ? undefined : `scale(${1.03 + frame * 0.0002})`,
              }}
            />
            <div
              style={{
                position: "absolute",
                bottom: 22,
                left: 22,
                background: "#0a0c11e8",
                padding: "16px 24px",
                borderRadius: 12,
                fontFamily: mono,
                fontSize: 19,
                color: c.accent,
              }}
            >
              ✓ image/png · delivered
            </div>
          </div>
        </Rise>
      </div>
    </Stage>
  );
}
const capabilities = [
  ["01", "code.generate", "Write complete code"],
  ["02", "code.review", "Find actionable defects"],
  ["03", "reason.analyze", "Work through a decision"],
  ["04", "image.generate", "Create an image"],
  ["05", "image.analyze", "Describe, compare, read text"],
  ["06", "image.edit", "Change an existing image"],
];
export function Capabilities() {
  return (
    <Stage
      index={5}
      title="Six task types"
      seconds={6}
      note="Development capabilities. Image analysis/editing have fixture coverage; live access depends on provider UI."
    >
      <Rise style={{ marginTop: 70 }}>
        <Tag>Pick the work. Keep the workflow.</Tag>
        <Headline size={82}>Six tasks. One MCP connection.</Headline>
      </Rise>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gap: 22,
          marginTop: 45,
        }}
      >
        {capabilities.map(([number, title, description], index) => (
          <Rise key={title} delay={index * 2}>
            <div
              style={{
                borderTop: `2px solid ${index < 3 ? c.accent : c.violet}`,
                background: c.panel,
                padding: 28,
                height: 210,
              }}
            >
              <Tag>{number}</Tag>
              <div style={{ fontFamily: mono, fontSize: 30, marginTop: 25 }}>
                {title}
              </div>
              <div style={{ fontSize: 23, color: c.muted, marginTop: 16 }}>
                {description}
              </div>
            </div>
          </Rise>
        ))}
      </div>
    </Stage>
  );
}
export function Install() {
  return (
    <Stage
      index={6}
      title="One-command setup"
      seconds={6}
      light
      note="Requires Node.js 24+, npm, your own ChatGPT account and manual sign-in."
    >
      <Rise style={{ marginTop: 74 }}>
        <Tag light>From terminal to MCP client</Tag>
        <Headline size={104}>
          ONE COMMAND.
          <br />
          <span style={{ opacity: 0.75 }}>YOUR OWN SESSION.</span>
        </Headline>
      </Rise>
      <Rise delay={3}>
        <div
          style={{
            background: c.background,
            borderRadius: 20,
            border: "2px solid #59772f",
            padding: "41px 48px",
            marginTop: 24,
            fontFamily: mono,
            fontSize: 37,
            color: c.text,
            letterSpacing: -1,
          }}
        >
          <span style={{ color: c.accent }}>$ </span>
          npx -y @rnaefe/chatgpt-wrapper@0.4.2
        </div>
      </Rise>
      <Rise delay={8}>
        <div
          style={{
            display: "flex",
            gap: 65,
            marginTop: 55,
            fontFamily: mono,
            fontSize: 28,
            fontWeight: 500,
          }}
        >
          <span>01 / Install</span>
          <span>→</span>
          <span>02 / Sign in</span>
          <span>→</span>
          <span>03 / Use from Codex</span>
        </div>
      </Rise>
    </Stage>
  );
}
export function Outro() {
  return (
    <Stage
      index={7}
      title="Open source"
      seconds={4}
      note="Unofficial and experimental. Provider UI and verification can interrupt tasks."
    >
      <Rise style={{ marginTop: 118 }}>
        <Tag>Open source · GPLv3</Tag>
        <Headline size={138}>
          TRY IT.
          <br />
          <span style={{ color: c.accent }}>BREAK IT. FIX IT.</span>
        </Headline>
      </Rise>
      <Rise delay={3}>
        <div style={{ fontFamily: mono, fontSize: 38, marginTop: 36 }}>
          github.com/rnaefe/chatgpt-wrapper ↗
        </div>
        <p style={{ fontSize: 25, color: c.muted, marginTop: 30 }}>
          Contributions and feedback welcome.
        </p>
      </Rise>
    </Stage>
  );
}
