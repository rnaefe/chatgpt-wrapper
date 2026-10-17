import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

function findPackageRoot(start: string): string {
  let current = start;
  for (;;) {
    const manifest = join(current, "package.json");
    if (existsSync(manifest)) {
      const value = JSON.parse(readFileSync(manifest, "utf8")) as {
        bin?: Record<string, string>;
      };
      if (value.bin?.["chatgpt-wrapper"]) return current;
    }
    const parent = dirname(current);
    if (parent === current)
      throw new Error("Wrapper package.json was not found");
    current = parent;
  }
}
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const packageRoot = findPackageRoot(moduleDirectory);
export const packaged = moduleDirectory === join(packageRoot, "dist");
export const packageMetadata = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
) as { name: string; version: string };
export const daemonEntry = join(
  packageRoot,
  packaged ? "dist/daemon.js" : "apps/daemon/dist/index.js",
);
export const mcpEntry = join(
  packageRoot,
  packaged ? "dist/mcp.js" : "apps/daemon/dist/mcp.js",
);
export const cliEntry = join(
  packageRoot,
  packaged ? "dist/cli.js" : "apps/daemon/dist/cli.js",
);
export const enginePath = join(
  packageRoot,
  packaged ? "dist/page-engine.js" : "apps/daemon/dist/page-engine.js",
);

export function userDataDirectory(
  platform = process.platform,
  home = homedir(),
  env = process.env,
) {
  if (platform === "win32")
    return join(
      env.LOCALAPPDATA ?? join(home, "AppData", "Local"),
      "ChatGPT Wrapper",
    );
  if (platform === "darwin")
    return join(home, "Library", "Application Support", "ChatGPT Wrapper");
  return join(
    env.XDG_DATA_HOME ?? join(home, ".local", "share"),
    "chatgpt-wrapper",
  );
}
export function loadEnvironment() {
  // Only development builds load their repository's .env. Never read the caller's cwd.
  const file = join(packageRoot, ".env");
  if (!packaged && existsSync(file)) process.loadEnvFile(file);
}
export function dataDirectory() {
  return resolve(
    process.env.DATA_DIR ??
      (packaged ? userDataDirectory() : join(packageRoot, ".data")),
  );
}
