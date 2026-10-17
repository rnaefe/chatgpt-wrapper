import { spawn } from "node:child_process";
import {
  existsSync,
  realpathSync,
  readFileSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { dirname, join, delimiter, resolve } from "node:path";
import { createRequire } from "node:module";
import { packageMetadata } from "./runtime-paths.js";

export async function runNode(
  script: string,
  args: string[],
  env = process.env,
) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`Command failed (${signal ?? code}): ${script}`)),
    );
  });
}
function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    join(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
    ...(process.env.PATH ?? "").split(delimiter).map((dir) => join(dir, "npm")),
  ];
  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue;
    const actual = realpathSync(candidate);
    if (actual.endsWith("npm-cli.js")) return actual;
  }
  throw new Error(
    "npm was not found. Install Node.js with npm, then run setup again.",
  );
}
export async function installRuntime(
  directory: string,
  spec = `${packageMetadata.name}@${packageMetadata.version}`,
) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const prefix = resolve(directory, "runtime", packageMetadata.version);
  const cachedRoot = join(
    prefix,
    "node_modules",
    ...packageMetadata.name.split("/"),
  );
  if (
    spec === `${packageMetadata.name}@${packageMetadata.version}` &&
    existsSync(join(cachedRoot, "package.json"))
  ) {
    const cached = JSON.parse(
      readFileSync(join(cachedRoot, "package.json"), "utf8"),
    );
    if (
      cached.name === packageMetadata.name &&
      cached.version === packageMetadata.version &&
      ["cli.js", "daemon.js", "mcp.js", "page-engine.js"].every((file) =>
        existsSync(join(cachedRoot, "dist", file)),
      )
    )
      return { root: cachedRoot, cli: join(cachedRoot, "dist", "cli.js") };
  }
  await runNode(npmCli(), [
    "install",
    "--prefix",
    prefix,
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--",
    spec,
  ]);
  const root = join(prefix, "node_modules", ...packageMetadata.name.split("/"));
  const manifest = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ) as { name: string; version: string };
  if (
    manifest.name !== packageMetadata.name ||
    manifest.version !== packageMetadata.version
  )
    throw new Error(
      `Expected ${packageMetadata.name}@${packageMetadata.version}; received ${manifest.name}@${manifest.version}. Client configuration was not changed.`,
    );
  const cli = join(root, "dist", "cli.js");
  if (!existsSync(cli))
    throw new Error(
      "Installed package has no built CLI. Client configuration was not changed.",
    );
  return { root, cli };
}
export async function installBrowser(root: string) {
  const require = createRequire(join(root, "package.json"));
  await runNode(
    join(dirname(require.resolve("playwright/package.json")), "cli.js"),
    ["install", "chromium"],
  );
}
