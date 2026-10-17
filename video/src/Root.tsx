import React from "react";
import {
  AbsoluteFill,
  Composition,
  Series,
  registerRoot,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { loadFont as loadSans } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import session from "../public/session.json";
import { colors as c, scenes } from "./constants";

const { fontFamily: sans } = loadSans("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin"],
});
const { fontFamily: mono } = loadMono("normal", {
  weights: ["400", "500"],
  subsets: ["latin"],
});

function Enter({ children }: { children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 30 } });
  return (
    <div
      style={{
        opacity: interpolate(p, [0, 0.35], [0, 1], {
          extrapolateRight: "clamp",
        }),
        transform: `scale(${0.97 + 0.03 * p})`,
        transformOrigin: "center",
      }}
    >
      {children}
    </div>
  );
}
function Shell({
  label,
  title,
  subtitle,
  children,
}: {
  label: string;
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <AbsoluteFill
      style={{
        background: c.background,
        color: c.text,
        fontFamily: sans,
        padding: "64px 96px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: mono,
          fontSize: 19,
          letterSpacing: 2,
          color: c.muted,
        }}
      >
        <span>CHATGPT WRAPPER / {label}</span>
        <span style={{ color: c.green }}>ONBOARDING PREVIEW</span>
      </div>
      <div style={{ height: 1, background: c.line, marginTop: 28 }} />
      <Enter>
        <h1
          style={{
            fontSize: 65,
            lineHeight: 1.12,
            letterSpacing: -2.6,
            margin: "38px 0 16px",
            fontWeight: 600,
          }}
        >
          {title}
        </h1>
        <p style={{ fontSize: 25, color: c.muted, margin: 0 }}>{subtitle}</p>
        {children}
      </Enter>
      <div
        style={{
          position: "absolute",
          left: 96,
          right: 96,
          bottom: 38,
          display: "flex",
          justifyContent: "space-between",
          fontFamily: mono,
          fontSize: 17,
          color: c.muted,
        }}
      >
        <span>Local build · saved ChatGPT session · waiting shortened</span>
        <span>github.com/rnaefe/chatgpt-wrapper</span>
      </div>
    </AbsoluteFill>
  );
}
function Terminal({
  command,
  lines,
  pace = 6,
  label = "REAL TERMINAL OUTPUT",
}: {
  command: string;
  lines: string[];
  pace?: number;
  label?: string;
}) {
  const frame = useCurrentFrame();
  const visible = Math.max(0, Math.floor((frame - 18) / pace));
  return (
    <div
      style={{
        marginTop: 35,
        border: `1px solid ${c.line}`,
        borderRadius: 16,
        overflow: "hidden",
        background: c.panel,
      }}
    >
      <div
        style={{
          height: 48,
          background: c.panelHeader,
          display: "flex",
          alignItems: "center",
          padding: "0 28px",
          gap: 10,
        }}
      >
        {[0, 1, 2].map((n) => (
          <span
            key={n}
            style={{
              width: 10,
              height: 10,
              borderRadius: 10,
              background: c.muted,
              opacity: 0.35,
            }}
          />
        ))}
        <span
          style={{
            marginLeft: 20,
            color: c.muted,
            fontFamily: mono,
            fontSize: 16,
          }}
        >
          {label}
        </span>
      </div>
      <div
        style={{
          padding: "28px 32px",
          height: 510,
          fontFamily: mono,
          fontSize: 25,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        <div style={{ color: c.green, marginBottom: 15 }}>$ {command}</div>
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              opacity: i < visible ? 1 : 0,
              color: line.startsWith("✓") ? c.green : c.text,
            }}
          >
            {line || " "}
          </div>
        ))}
      </div>
    </div>
  );
}
function Intro() {
  return (
    <Shell
      label="01 / START"
      title="Make the first run the easy part."
      subtitle="ChatGPT tasks, inside your MCP coding workflow."
    >
      <div style={{ marginTop: 100, display: "flex", gap: 40 }}>
        {["Install", "Connect", "Get a result"].map((item, i) => (
          <div
            key={item}
            style={{
              width: 515,
              borderTop: `2px solid ${c.green}`,
              paddingTop: 30,
            }}
          >
            <div style={{ fontFamily: mono, color: c.green, fontSize: 20 }}>
              0{i + 1}
            </div>
            <div style={{ fontSize: 43, marginTop: 22 }}>{item}</div>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 70, fontSize: 23, color: c.muted }}>
        A real development-build run. No credentials or account pages shown.
      </p>
    </Shell>
  );
}
function Setup() {
  const lines = session.setup.filter(
    (line) =>
      !line.startsWith("ChatGPT Wrapper") &&
      !line.startsWith("Ready.") &&
      !line.startsWith('"Use Wrapper'),
  );
  return (
    <Shell
      label="02 / INSTALL"
      title="A clear path to a working connection."
      subtitle="Isolated Codex config. Chromium checked. Installed MCP server verified."
    >
      <Terminal command="node dist/cli.js setup --skip-login …" lines={lines} />
    </Shell>
  );
}
function Connect() {
  return (
    <Shell
      label="03 / CONNECT"
      title="Your saved session is ready."
      subtitle="Initial sign-in uses the browser. This run reuses an existing session."
    >
      <Terminal
        command="node dist/cli.js connect --visible …"
        lines={session.connect}
      />
    </Shell>
  );
}
function Task() {
  return (
    <Shell
      label="04 / LIVE MCP"
      title="A public prompt. A real response."
      subtitle={`The task completed in ${session.seconds}s. This scene is an edited terminal summary.`}
    >
      <Terminal
        command="MCP: submit_task → get_task"
        lines={session.task}
        pace={18}
        label="LIVE MCP RESULT · RENDERED SUMMARY"
      />
    </Shell>
  );
}
function Architecture() {
  return (
    <Shell
      label="05 / UNDER THE HOOD"
      title="Local queue. One browser task at a time."
      subtitle="The saved profile stays private. The browser closes after each task."
    >
      <div
        style={{
          marginTop: 120,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {["MCP client", "SQLite queue", "ChatGPT", "Response"].map(
          (item, i) => (
            <React.Fragment key={item}>
              <div
                style={{
                  border: `1px solid ${c.line}`,
                  background: c.panel,
                  padding: "45px 35px",
                  borderRadius: 14,
                  fontFamily: mono,
                  fontSize: 28,
                }}
              >
                {item}
              </div>
              {i < 3 && <span style={{ color: c.green, fontSize: 35 }}>→</span>}
            </React.Fragment>
          ),
        )}
      </div>
      <p style={{ marginTop: 70, fontSize: 25, color: c.muted }}>
        Provider verification stays manual. Interrupted prompts are never
        replayed automatically.
      </p>
    </Shell>
  );
}
function Close() {
  return (
    <Shell
      label="06 / TRY IT"
      title="Use Wrapper from your coding client."
      subtitle="The released version is available on npm. This video previews the next CLI presentation."
    >
      <div
        style={{
          marginTop: 95,
          fontFamily: mono,
          fontSize: 38,
          color: c.green,
          padding: "38px 0",
          borderTop: `1px solid ${c.line}`,
          borderBottom: `1px solid ${c.line}`,
        }}
      >
        npx -y @rnaefe/chatgpt-wrapper@0.4.2
      </div>
      <p style={{ fontSize: 29, marginTop: 45 }}>
        Node.js 24+ · Your ChatGPT account · Restart Codex after setup
      </p>
      <p style={{ fontSize: 22, marginTop: 30, color: c.muted }}>
        Experimental. Visible mode is the default; headless access may require
        verification.
      </p>
    </Shell>
  );
}
const parts = [Intro, Setup, Connect, Task, Architecture, Close];
function Demo() {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      <Series>
        {parts.map((Part, i) => (
          <Series.Sequence key={i} durationInFrames={scenes[i] * fps}>
            <Part />
          </Series.Sequence>
        ))}
      </Series>
    </AbsoluteFill>
  );
}
function Root() {
  return (
    <Composition
      id="WrapperDemo"
      component={Demo}
      durationInFrames={scenes.reduce((a, b) => a + b, 0) * 30}
      fps={30}
      width={1920}
      height={1080}
    />
  );
}
registerRoot(Root);
