import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { configureClient, clientConfigPath } from "../src/client-config.js";
const directories: string[] = [];
function file(name = "config.toml") {
  const dir = mkdtempSync(join(tmpdir(), "wrapper-client-"));
  directories.push(dir);
  return join(dir, name);
}
const entry = {
  command: "/path with spaces/node",
  args: ["/path with spaces/cli.js", "mcp"],
  env: {
    DATA_DIR: "/private/session",
    PORT: "11435",
    BROWSER_HEADLESS: "false",
  },
};
afterEach(() =>
  directories
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);
it("merges a Codex entry, preserving other settings and an exact backup", () => {
  const path = file();
  const original =
    '# keep a backup of this comment\nmodel = "example"\n[mcp_servers.other]\ncommand = "other"\n';
  writeFileSync(path, original);
  const result = configureClient("codex", entry, { path });
  const doc = parse(readFileSync(path, "utf8"));
  expect(doc.model).toBe("example");
  expect(doc.mcp_servers).toEqual({
    other: { command: "other" },
    wrapper: entry,
  });
  expect(readFileSync(result.backup!, "utf8")).toBe(original);
  expect(configureClient("codex", entry, { path }).changed).toBe(false);
});
it("refuses to replace an existing entry without an explicit option", () => {
  const path = file();
  const original = '[mcp_servers.wrapper]\ncommand="old"\n';
  writeFileSync(path, original);
  expect(() => configureClient("codex", entry, { path })).toThrow("--replace");
  expect(readFileSync(path, "utf8")).toBe(original);
  configureClient("codex", entry, { path, replace: true });
  expect(
    (parse(readFileSync(path, "utf8")).mcp_servers as Record<string, unknown>)
      .wrapper,
  ).toEqual(entry);
});
it("does not overwrite malformed config or perform writes in a dry run", () => {
  const path = file();
  writeFileSync(path, "invalid = [");
  expect(() => configureClient("codex", entry, { path })).toThrow(
    "Cannot parse",
  );
  expect(readFileSync(path, "utf8")).toBe("invalid = [");
  const absent = file("absent/config.toml");
  expect(
    configureClient("codex", entry, { path: absent, dryRun: true }),
  ).toMatchObject({ dryRun: true });
});
it.each(["cursor", "claude-desktop"] as const)(
  "preserves unrelated JSON settings for %s",
  (client) => {
    const path = file("mcp.json");
    writeFileSync(
      path,
      JSON.stringify({
        theme: "dark",
        mcpServers: { other: { command: "other" } },
      }),
    );
    configureClient(client, entry, { path });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      theme: "dark",
      mcpServers: { other: { command: "other" }, wrapper: entry },
    });
  },
);
it("rejects invalid tables and non-file paths", () => {
  const path = file();
  writeFileSync(path, 'mcp_servers = "invalid"');
  expect(() => configureClient("codex", entry, { path })).toThrow(
    "must be an object",
  );
  const directory = file("directory");
  mkdirSync(directory);
  expect(() => configureClient("cursor", entry, { path: directory })).toThrow(
    "regular file",
  );
});
it("resolves supported client locations without relying on cwd", () => {
  expect(
    clientConfigPath("codex", "/home/test", "linux", {
      CODEX_HOME: "/custom/codex",
    }),
  ).toBe("/custom/codex/config.toml");
  expect(clientConfigPath("cursor", "/home/test", "linux", {})).toBe(
    "/home/test/.cursor/mcp.json",
  );
  expect(
    clientConfigPath("claude-desktop", "/home/test", "darwin", {}),
  ).toContain("Library/Application Support/Claude/claude_desktop_config.json");
});

it("upgrades only a managed runtime in the same data directory", () => {
  const path = file();
  const managed = {
    ...entry,
    args: [
      "/private/session/runtime/0.4.1/node_modules/@rnaefe/chatgpt-wrapper/dist/cli.js",
      "mcp",
    ],
  };
  configureClient("codex", managed, { path });
  const next = {
    ...managed,
    args: [managed.args[0].replace("0.4.1", "0.4.2"), "mcp"],
  };
  expect(() =>
    configureClient("codex", next, { path, managedDirectory: "/different" }),
  ).toThrow("--replace");
  const result = configureClient("codex", next, {
    path,
    managedDirectory: "/private/session",
  });
  expect(result.changed).toBe(true);
  expect(readFileSync(result.backup!, "utf8")).toContain("0.4.1");
});

it.each(["codex", "cursor", "claude-desktop"] as const)(
  "uninstalls only Wrapper from %s with an exact backup",
  (client) => {
    const path = file(client === "codex" ? "config.toml" : "config.json");
    const managed = {
      ...entry,
      args: [
        "/private/session/runtime/0.4.1/node_modules/@rnaefe/chatgpt-wrapper/dist/cli.js",
        "mcp",
      ],
    };
    const key = client === "codex" ? "mcp_servers" : "mcpServers";
    writeFileSync(
      path,
      client === "codex"
        ? '[mcp_servers.other]\ncommand="other"\n'
        : JSON.stringify({ mcpServers: { other: { command: "other" } } }),
    );
    configureClient(client, managed, { path });
    const original = readFileSync(path, "utf8");
    configureClient(client, null, {
      path,
      managedDirectory: "/private/session",
      dryRun: true,
    });
    expect(readFileSync(path, "utf8")).toBe(original);
    const removed = configureClient(client, null, {
      path,
      managedDirectory: "/private/session",
    });
    expect(readFileSync(removed.backup!, "utf8")).toBe(original);
    const text = readFileSync(path, "utf8");
    const doc = client === "codex" ? parse(text) : JSON.parse(text);
    expect(doc[key]).toEqual({ other: { command: "other" } });
    expect(configureClient(client, null, { path }).changed).toBe(false);
  },
);

it("refuses automatic replacement of malformed or relative runtime entries", () => {
  for (const previous of [
    { ...entry, env: { DATA_DIR: 42 } },
    {
      ...entry,
      args: [
        "runtime/0.4.2/node_modules/@rnaefe/chatgpt-wrapper/dist/cli.js",
        "mcp",
      ],
    },
  ]) {
    const path = file("config.json");
    const original = JSON.stringify({ mcpServers: { wrapper: previous } });
    writeFileSync(path, original);
    expect(() =>
      configureClient("cursor", entry, {
        path,
        managedDirectory: "/private/session",
      }),
    ).toThrow("--replace");
    expect(readFileSync(path, "utf8")).toBe(original);
  }
});
