import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  lstatSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { parse, stringify } from "smol-toml";

export type ClientName = "codex" | "cursor" | "claude-desktop";
export interface McpCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      `${label} must be an object. No configuration was changed.`,
    );
  return value as Record<string, unknown>;
}
export function clientConfigPath(
  client: ClientName,
  home = homedir(),
  platform = process.platform,
  env = process.env,
) {
  if (client === "codex")
    return join(env.CODEX_HOME ?? join(home, ".codex"), "config.toml");
  if (client === "cursor") return join(home, ".cursor", "mcp.json");
  if (platform === "darwin")
    return join(
      home,
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
  if (platform === "win32")
    return join(
      env.APPDATA ?? join(home, "AppData", "Roaming"),
      "Claude",
      "claude_desktop_config.json",
    );
  throw new Error(
    "Claude Desktop automatic configuration is supported on macOS and Windows. Use --config with an explicit JSON file on other systems.",
  );
}
function readConfiguration(client: ClientName, explicitPath?: string) {
  const path = resolve(explicitPath ?? clientConfigPath(client));
  if (existsSync(path) && !lstatSync(path).isFile())
    throw new Error(`Configuration must be a regular file: ${path}`);
  const original = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  let document: Record<string, unknown>;
  try {
    document = record(
      original
        ? client === "codex"
          ? parse(original)
          : JSON.parse(original)
        : {},
      "Configuration",
    );
  } catch (error) {
    throw new Error(
      `Cannot parse ${path}. No configuration was changed. ${error instanceof Error ? error.message : ""}`,
    );
  }
  const key = client === "codex" ? "mcp_servers" : "mcpServers";
  const servers = document[key] === undefined ? {} : record(document[key], key);
  return { path, original, document, key, servers };
}
export function managedClientEntry(
  client: ClientName,
  path?: string,
): McpCommand | undefined {
  const value = readConfiguration(client, path).servers.wrapper as
    McpCommand | undefined;
  return value?.env &&
    typeof value.env.DATA_DIR === "string" &&
    isAbsolute(value.env.DATA_DIR) &&
    isManagedEntry(value, value.env.DATA_DIR)
    ? value
    : undefined;
}
export function configureClient(
  client: ClientName,
  entry: McpCommand | null,
  options: {
    path?: string;
    replace?: boolean;
    dryRun?: boolean;
    managedDirectory?: string;
  } = {},
) {
  const { path, original, document, key, servers } = readConfiguration(
    client,
    options.path,
  );
  if (servers.wrapper !== undefined) {
    if (JSON.stringify(servers.wrapper) === JSON.stringify(entry))
      return { path, changed: false };
    if (
      !options.replace &&
      !(
        options.managedDirectory &&
        isManagedEntry(servers.wrapper, options.managedDirectory)
      )
    )
      throw new Error(
        `A Wrapper entry already exists in ${path}. Use --replace to update only that entry; a backup will be saved.`,
      );
  }
  if (entry === null && servers.wrapper === undefined)
    return { path, changed: false };
  const merged = { ...servers };
  if (entry === null) delete merged.wrapper;
  else merged.wrapper = entry;
  document[key] = merged;
  const text =
    client === "codex"
      ? stringify(document)
      : JSON.stringify(document, null, 2) + "\n";
  // Validate the complete merged document before touching the user's file.
  if (client === "codex") parse(text);
  else JSON.parse(text);
  if (options.dryRun) return { path, changed: true, dryRun: true };
  mkdirSync(dirname(path), { recursive: true });
  if ((existsSync(path) ? readFileSync(path, "utf8") : undefined) !== original)
    throw new Error("Configuration changed during setup. Run setup again.");
  const backup =
    original === undefined
      ? undefined
      : `${path}.wrapper-backup-${Date.now()}-${randomUUID().slice(0, 8)}`;
  if (backup) writeFileSync(backup, original!, { flag: "wx", mode: 0o600 });
  const temporary = `${path}.wrapper-${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, text, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return { path, changed: true, backup };
}

/** Recognize only versioned Wrapper runtimes for the same private data directory. */
export function isManagedEntry(value: unknown, directory: string): boolean {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<McpCommand>;
  if (
    !entry.env ||
    typeof entry.env.DATA_DIR !== "string" ||
    !isAbsolute(entry.env.DATA_DIR) ||
    resolve(entry.env.DATA_DIR) !== resolve(directory) ||
    !Array.isArray(entry.args) ||
    entry.args.length !== 2 ||
    entry.args[1] !== "mcp" ||
    typeof entry.args[0] !== "string" ||
    !isAbsolute(entry.args[0])
  )
    return false;
  const path = relative(
    resolve(directory, "runtime"),
    entry.args[0],
  ).replaceAll("\\", "/");
  return (
    !isAbsolute(path) &&
    /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?\/node_modules\/@rnaefe\/chatgpt-wrapper\/dist\/cli\.js$/.test(
      path,
    )
  );
}
