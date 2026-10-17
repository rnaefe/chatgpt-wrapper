#!/usr/bin/env node
import { parseArgs } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { configureClient, managedClientEntry } from "./client-config.js";
import { installRuntime, installBrowser, runNode } from "./install-runtime.js";
import {
  packageMetadata,
  packageRoot,
  userDataDirectory,
  dataDirectory,
  loadEnvironment,
  daemonEntry,
  mcpEntry,
  enginePath,
} from "./runtime-paths.js";

const help = `ChatGPT Wrapper ${packageMetadata.version}

Usage: chatgpt-wrapper <command> [options]

  setup                                      Install and configure Codex (default)
  update                                     Upgrade the managed runtime and restart its idle worker
  uninstall                                  Remove Wrapper from the client; preserve saved data
  connect                                    Sign in using the visible browser
  mcp                                        Start the MCP stdio server
  status                                     Show local worker and browser status
  metrics [--hours 24]                        Task success rates and duration percentiles
  errors [--hours 24] [--limit 20]             Recent task IDs and error codes
  stop                                       Stop an idle worker and its browser
  verify-browser --mode visible|headless|both  Run live MCP probes using your saved profile
  doctor                                     Check the installation without starting a browser

Options:
  --config PATH     Explicit client config file (useful for isolated setups)
  --data-dir PATH   Private runtime/profile location; defaults to user app data
  --port NUMBER     Local worker port; default 11435
  --force-login     Open sign-in even if already connected
  --replace         Replace an existing wrapper entry, keeping a backup
  --skip-login      Configure MCP now; sign in later with connect
  --visible         Use visible execution, overriding the environment
  --headless        Experimental headless verification and execution
  --mode MODE       Browser modes for live verification; default both
  --report PATH     Save a private verification report
  --timeout NUMBER  Per-probe deadline in seconds; default 90
  --package SPEC    Package tarball/spec for local release testing
  --dry-run         Validate the config change without installing or writing files
  --help, --version
`;
async function main() {
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("Node.js 24 or newer is required.");
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      hours: { type: "string" },
      limit: { type: "string" },
      mode: { type: "string" },
      report: { type: "string" },
      timeout: { type: "string" },
      help: { type: "boolean" },
      version: { type: "boolean" },
      client: { type: "string" },
      config: { type: "string" },
      "data-dir": { type: "string" },
      port: { type: "string" },
      replace: { type: "boolean" },
      "force-login": { type: "boolean" },
      "skip-login": { type: "boolean" },
      visible: { type: "boolean" },
      headless: { type: "boolean" },
      package: { type: "string" },
      "dry-run": { type: "boolean" },
    },
  });
  if (values.version) {
    console.log(packageMetadata.version);
    return;
  }
  const command = positionals[0] ?? "setup";
  if (values.help) {
    console.log(help);
    return;
  }
  if (positionals.length > 1)
    throw new Error("Unexpected arguments. Run chatgpt-wrapper --help.");
  if (values["data-dir"]) process.env.DATA_DIR = resolve(values["data-dir"]);
  if (values.port) {
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("--port must be an integer between 1 and 65535.");
    process.env.PORT = String(port);
    process.env.WRAPPER_URL = `http://127.0.0.1:${port}`;
  }
  if (values.visible && values.headless)
    throw new Error("Choose either --visible or --headless.");
  if (values.visible) process.env.BROWSER_HEADLESS = "false";
  if (values.headless) process.env.BROWSER_HEADLESS = "true";
  if (["setup", "update", "uninstall"].includes(command)) {
    const client = values.client ?? "codex";
    if (
      client !== "codex" &&
      client !== "cursor" &&
      client !== "claude-desktop"
    )
      throw new Error(
        "Choose an MCP client with --client codex, cursor, or claude-desktop.",
      );
    const saved = managedClientEntry(client, values.config);
    const directory = resolve(
      values["data-dir"] ??
        saved?.env.DATA_DIR ??
        process.env.DATA_DIR ??
        userDataDirectory(),
    );
    const port = String(
      values.port ?? saved?.env.PORT ?? process.env.PORT ?? 11435,
    );
    if (
      !Number.isInteger(Number(port)) ||
      Number(port) < 1 ||
      Number(port) > 65535
    )
      throw new Error("Configured port must be between 1 and 65535.");
    const env = {
      ...saved?.env,
      DATA_DIR: directory,
      PORT: port,
      WRAPPER_URL: `http://127.0.0.1:${port}`,
      BROWSER_HEADLESS: values.headless
        ? "true"
        : values.visible
          ? "false"
          : (saved?.env.BROWSER_HEADLESS ?? "false"),
    };
    if (command === "uninstall") {
      const options = {
        path: values.config,
        replace: values.replace,
        managedDirectory: directory,
      };
      const preview = configureClient(client, null, {
        ...options,
        dryRun: true,
      });
      if (values["dry-run"]) {
        console.log(JSON.stringify(preview, null, 2));
        return;
      }
      const { stopWorker } = await import("./worker-control.js");
      await stopWorker(directory, env.WRAPPER_URL);
      const result = configureClient(client, null, options);
      console.log(
        `Wrapper ${result.changed ? "removed from" : "is not configured in"}: ${result.path}`,
      );
      if (result.backup) console.log(`Backup: ${result.backup}`);
      console.log(
        `Restart ${client}. Saved sessions, history and runtime files remain in ${directory}.`,
      );
      return;
    }
    const previewCli = join(
      directory,
      "runtime",
      packageMetadata.version,
      "node_modules",
      ...packageMetadata.name.split("/"),
      "dist",
      "cli.js",
    );
    const entry = { command: process.execPath, args: [previewCli, "mcp"], env };
    // Fail invalid/conflicting configs before downloading or installing anything.
    const preview = configureClient(client, entry, {
      path: values.config,
      replace: values.replace,
      dryRun: true,
      managedDirectory: directory,
    });
    if (values["dry-run"]) {
      console.log(JSON.stringify({ client, ...preview, entry }, null, 2));
      return;
    }
    console.log(`\nChatGPT Wrapper ${packageMetadata.version}\n`);
    console.log(`✓ ${client} configuration checked`);
    console.log("→ Installing the local runtime");
    const installed = await installRuntime(directory, values.package);
    console.log("✓ Runtime installed");
    console.log("→ Checking Chromium");
    await installBrowser(installed.root);
    console.log("✓ Browser ready");
    const { stopWorker } = await import("./worker-control.js");
    if (
      (preview.changed || command === "update") &&
      (await stopWorker(directory, env.WRAPPER_URL))
    )
      console.log("Stopped the idle worker so the new runtime can take over.");
    const changed = configureClient(
      client,
      { ...entry, args: [installed.cli, "mcp"] },
      {
        path: values.config,
        replace: values.replace,
        managedDirectory: directory,
      },
    );
    console.log(
      `✓ ${client} ${changed.changed ? "configured" : "already configured"}`,
    );
    if (changed.backup) console.log(`Backup: ${changed.backup}`);
    const { checkMcp } = await import("./mcp-check.js");
    const toolCount = await checkMcp({
      ...entry,
      args: [installed.cli, "mcp"],
    });
    console.log(`✓ MCP connection verified (${toolCount} tools)`);
    if (!values["skip-login"] && command !== "update")
      await runNode(installed.cli, ["connect"], { ...process.env, ...env });
    else
      console.log(
        `${command === "update" ? "Update ready. Saved session will be checked on the next task. Reconnect if requested" : "Sign in later"}: ${JSON.stringify(process.execPath)} ${JSON.stringify(installed.cli)} connect --data-dir ${JSON.stringify(directory)} --port ${port}${values.headless ? " --headless" : ""}`,
      );
    console.log(`\nReady. Restart ${client}, then try:`);
    console.log(
      '"Use Wrapper to write a TypeScript clamp function with an example."',
    );
    return;
  }
  loadEnvironment();
  if (command === "stop") {
    const { stopWorker } = await import("./worker-control.js");
    console.log(
      (await stopWorker(
        dataDirectory(),
        process.env.WRAPPER_URL ??
          `http://127.0.0.1:${process.env.PORT ?? 11435}`,
      ))
        ? "Worker stopped. Saved profile and task history were kept."
        : "Worker is not running.",
    );
    return;
  }
  if (command === "verify-browser") {
    const mode = values.mode ?? "both";
    if (mode !== "visible" && mode !== "headless" && mode !== "both")
      throw new Error("--mode must be visible, headless, or both.");
    const timeout = Number(values.timeout ?? 90);
    if (!Number.isInteger(timeout) || timeout < 10 || timeout > 300)
      throw new Error("--timeout must be between 10 and 300 seconds.");
    console.log(
      "Live verification sends up to two small public coding prompts per mode. No retries, profile copies, or credential export.",
    );
    const { verifyBrowsers } = await import("./browser-verification.js");
    const result = await verifyBrowsers({
      directory: dataDirectory(),
      mode,
      report: values.report,
      timeoutSeconds: timeout,
    });
    if (!result.passed) process.exitCode = 1;
    return;
  }
  if (command === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (command === "connect") {
    // Explicit opt-in; visible mode is the default for reliable manual verification.
    process.env.BROWSER_HEADLESS = values.headless
      ? "true"
      : (process.env.BROWSER_HEADLESS ?? "false");
    await installBrowser(packageRoot);
    const { connectBrowser } = await import("./browser-login.js");
    await connectBrowser(values["force-login"]);
    return;
  }
  if (command === "metrics" || command === "errors") {
    const hours = Number(values.hours ?? 24);
    const limit = Number(values.limit ?? 20);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720)
      throw new Error("--hours must be between 1 and 720.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("--limit must be between 1 and 100.");
    const { localClient } = await import("./local-client.js");
    const request = await localClient();
    const path =
      command === "metrics"
        ? `/v1/metrics?hours=${hours}`
        : `/v1/errors?hours=${hours}&limit=${limit}`;
    console.log(JSON.stringify(await (await request(path)).json(), null, 2));
    return;
  }
  if (command === "status") {
    const { localClient } = await import("./local-client.js");
    const request = await localClient();
    console.log(
      JSON.stringify(await (await request("/v1/status")).json(), null, 2),
    );
    return;
  }
  if (command === "doctor") {
    const directory = dataDirectory();
    const lock = join(directory, "daemon.lock");
    let daemonRunning = false;
    if (existsSync(lock)) {
      const pid = Number(readFileSync(lock, "utf8"));
      if (Number.isSafeInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          daemonRunning = true;
        } catch {}
      }
    }
    console.log(
      JSON.stringify(
        {
          version: packageMetadata.version,
          node: process.versions.node,
          dataDirectory: directory,
          daemonRunning,
          files: {
            daemon: existsSync(daemonEntry),
            mcp: existsSync(mcpEntry),
            engine: existsSync(enginePath),
          },
        },
        null,
        2,
      ),
    );
    return;
  }
  throw new Error(`Unknown command: ${command}. Run chatgpt-wrapper --help.`);
}
main().catch((error) => {
  console.error(
    `Wrapper: ${error instanceof Error ? error.message : "Command failed"}`,
  );
  process.exitCode = 1;
});
