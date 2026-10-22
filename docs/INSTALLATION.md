# Installation

The quickest way to use ChatGPT Wrapper is through the published npm package. **You do not need to clone this repository.**

## Requirements

- **Node.js 24+** and npm.
- A desktop environment that can open Chromium.
- A ChatGPT account and permission to use the provider interface.
- An MCP client such as Codex. Configuration helpers are also available for Cursor and Claude Desktop.

The full setup and live coding workflow have been verified on macOS. Windows/Linux browser execution has not yet received equivalent end-to-end acceptance testing. Headless mode is experimental.

## Codex: install in one command

```bash
npx -y @rnaefe/chatgpt-wrapper@0.6.0
```

The installer sets up a persistent runtime and Chromium, creates or updates the `wrapper` MCP entry in Codex, and opens a browser for manual ChatGPT sign-in. It backs up an existing configuration before changing it.

Once sign-in succeeds:

1. Restart Codex so it picks up the new MCP server.
2. Ask Codex to use Wrapper, for example:

   > Use Wrapper to generate a TypeScript clamp function with explicit types. Check the task until it finishes and show me the result.

3. Review the result before applying any changes.

There is no OpenAI API key requirement. **This is an unofficial browser integration; account limits and verification challenges still apply.**

## Other MCP clients

Use the same installer, choosing a client:

```bash
# Cursor
npx -y @rnaefe/chatgpt-wrapper@0.6.0 setup --client cursor

# Claude Desktop
npx -y @rnaefe/chatgpt-wrapper@0.6.0 setup --client claude-desktop
```

| Client         | Default configuration                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Codex          | `$CODEX_HOME/config.toml` or `~/.codex/config.toml`                                                                              |
| Cursor         | `~/.cursor/mcp.json`                                                                                                             |
| Claude Desktop | macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows: `%APPDATA%/Claude/claude_desktop_config.json` |

On systems without a supported default configuration path, use `--config /absolute/path/to/config`. You can also override the path on supported systems.

A matching managed Wrapper entry is upgraded in place; unrelated MCP entries are preserved. A conflicting `wrapper` entry requires `--replace`. Existing configuration files are backed up before modification. Serialization may normalize formatting or remove comments, so keep your backups.

Preview the setup plan without changing files:

```bash
npx -y @rnaefe/chatgpt-wrapper@0.6.0 setup --client codex --dry-run
```

To configure without signing in immediately, add `--skip-login`, then run `connect` when you're ready.

## Use Wrapper

Once installed, the MCP server appears as **`wrapper`** in your client after restart. Ask the client to submit a task and inspect its result. You can also use the exposed tools directly.

See the [MCP usage guide](MCP.md) for capabilities, request schema, task statuses and artifact retrieval.

## Check or repair an installation

```bash
# Inspect local installation without starting a browser
npx -y @rnaefe/chatgpt-wrapper@latest doctor

# Start the sign-in flow again if needed
npx -y @rnaefe/chatgpt-wrapper@latest connect

# Inspect the current worker/browser status
npx -y @rnaefe/chatgpt-wrapper@latest status
```

The browser opens visibly for authentication and each task. It closes after use and reuses the private saved profile. Browser challenges must be completed manually. Wrapper does not automatically replay interrupted submissions.

If it cannot connect, see [troubleshooting](TROUBLESHOOTING.md). If a headless task is blocked, use the default visible mode instead of attempting to bypass verification. See [browser reliability](BROWSER_RELIABILITY.md) for known limitations.

## Updating and removing

Upgrade the managed runtime and MCP entry:

```bash
npx -y @rnaefe/chatgpt-wrapper@latest update
```

Restart your MCP client afterward. For a custom client or configuration path, pass the same `--client` and `--config` values used during setup. Wrapper won't silently cancel unfinished tasks during an update.

To remove the Wrapper entry from a selected client:

```bash
npx -y @rnaefe/chatgpt-wrapper@latest uninstall
```

This removes the selected client's managed configuration entry but **does not erase** browser credentials, history, runtime packages, logs or task artifacts. If several clients use Wrapper, remove each entry first.

If you want to erase all saved data: stop the worker, uninstall Wrapper from every client, then manually delete the printed application-data directory. Be sure no other installation uses it.

## Where your data is stored

| Platform | Default location                                                     |
| -------- | -------------------------------------------------------------------- |
| macOS    | `~/Library/Application Support/ChatGPT Wrapper`                      |
| Linux    | `$XDG_DATA_HOME/chatgpt-wrapper` or `~/.local/share/chatgpt-wrapper` |
| Windows  | `%LOCALAPPDATA%/ChatGPT Wrapper`                                     |

The persistent Chromium profile, local API token, queue, history and logs live here, outside the npm package. Do not share this directory. Task prompts and user-provided image inputs are sent to ChatGPT. Local task retention defaults to 30 days, but credentials and logs remain until manually deleted. See [security and privacy](SECURITY.md).

## Developers

Want to change the source instead of installing the npm release? Start with [CONTRIBUTING.md](../CONTRIBUTING.md) for the workspace setup, tests, and release checks.
