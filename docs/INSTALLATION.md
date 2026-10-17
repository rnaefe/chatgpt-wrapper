# Installation

## Install

Version `0.4.1` adds on-demand browser windows. Registry installation, persistent runtime setup, and the seven-tool MCP handshake were verified on macOS on 2026-10-17. The package name is `@rnaefe/chatgpt-wrapper`. The unscoped `chatgpt-wrapper` name belongs to an existing, different npm package.

Run:

```sh
npx -y @rnaefe/chatgpt-wrapper@0.4.1 setup --client codex
```

Requires Node.js 24+ with npm and a desktop session for manual ChatGPT sign-in. No repository clone, pnpm, API key, or manual MCP JSON/TOML editing is needed by end users.

Setup installs a versioned runtime in the user's application-data directory, installs Playwright Chromium, configures the selected client, and opens the sign-in flow. MCP points to that persistent runtime, not the temporary `npx` cache. Restart the MCP client after setup.

Visible browser mode is selected during setup. Complete login or browser verification yourself. The window closes after sign-in; each task opens the saved profile and closes its window when finished. `--headless` is experimental and may encounter provider verification. Nothing automatically solves or bypasses verification.

## Test the package before publishing

Maintainers build and pack the candidate:

```sh
pnpm install
pnpm build
npm pack --ignore-scripts
```

Then, from any directory, using the absolute tarball path:

```sh
npx -y --package /absolute/path/rnaefe-chatgpt-wrapper-0.4.1.tgz chatgpt-wrapper setup --client codex --package /absolute/path/rnaefe-chatgpt-wrapper-0.4.1.tgz
```

`--package` tells setup to install that tarball into its persistent runtime. Without it, setup installs the exact published name and version of the running CLI.

`pnpm test:package` automates a clean install in a temporary directory. It preserves another Codex server, removes the temporary bootstrap installation, then initializes MCP from the persistent runtime. It does not access a ChatGPT account or send prompts.

## Client configuration

Supported setup targets:

| Client           | Default configuration                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `codex`          | `$CODEX_HOME/config.toml`, or `~/.codex/config.toml`                                                                           |
| `cursor`         | `~/.cursor/mcp.json`                                                                                                           |
| `claude-desktop` | macOS `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows `%APPDATA%/Claude/claude_desktop_config.json` |

Use `--config /absolute/path` for an explicit configuration file. Claude Desktop's automatic path is supported on macOS and Windows; other systems require `--config`.

Existing settings and other MCP servers are preserved as values. Config serialization can normalize formatting and remove comments. Every changed existing file gets an exact, private backup next to it. Invalid config files are not overwritten. An existing, different `wrapper` entry requires `--replace`; a matching entry is left untouched.

Preview without installing, downloading, or writing:

```sh
chatgpt-wrapper setup --client codex --dry-run
```

Setup config formats follow the [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Cursor MCP documentation](https://cursor.com/help/customization/mcp), and [Claude Desktop MCP quickstart](https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers).

## Commands and options

- `setup --client codex`: persistent install, browser install, client configuration and login.
- `setup --skip-login`: configure now, sign in later. Prints the exact installed command.
- `setup --replace`: update an existing Wrapper entry after backing up the config.
- `connect`: install Chromium if missing and open the login flow.
- `mcp`: stdio MCP server; stdout is reserved for protocol messages.
- `stop`: stop an authenticated idle worker and close its browser, keeping saved data. Refuses unfinished tasks or a mismatched PID.
- `verify-browser --mode both`: explicitly run live probes; see [browser reliability](BROWSER_RELIABILITY.md).
- `metrics --hours 24` and `errors --hours 24 --limit 20`: inspect local task metrics; see [observability](OBSERVABILITY.md).
- `status`: show worker/browser status as JSON. Starts the local worker if needed.
- `doctor`: inspect local paths and process status without starting a worker or browser.

`--data-dir` and `--port` are stored in the MCP entry so the client uses the same private runtime. Choose another port when an existing development worker owns 11435. The installer does not terminate unrelated workers or overwrite their session data.

Default application data:

- macOS: `~/Library/Application Support/ChatGPT Wrapper`
- Linux: `$XDG_DATA_HOME/chatgpt-wrapper`, or `~/.local/share/chatgpt-wrapper`
- Windows: `%LOCALAPPDATA%/ChatGPT Wrapper`

Profiles, tokens, task databases, and logs live outside the package and survive package upgrades. Do not share this directory. Development commands keep using the repository's `.data` unless `DATA_DIR` is set. Packaged commands never read a `.env` from the caller's working directory.

## Updating and removing

After publishing a new version, run its setup command with `--replace`. Each version gets its own runtime directory; user data remains shared. Run the old runtime's `stop` command while its queue is idle, then restart the MCP client to use the new runtime. Automatic migration of running workers is not implemented.

To disconnect, remove only `wrapper` from the client's MCP configuration, or restore the saved backup when no subsequent config changes need preserving. Stop the Wrapper worker before removing its application-data directory. Removing that directory deletes the saved sign-in and task history. An automatic uninstall command is not implemented.

## Maintainer release checks

```sh
pnpm release:check
node scripts/test-package.mjs --registry
npm pack --dry-run --ignore-scripts
```

The package contains built distribution files, the README, license and this guide. Workspace source packages and their `workspace:*` dependencies are bundled; npm users do not need the monorepo. There are no install scripts or CI workflows. Do not publish until npm namespace access, licensing, and provider authorization for distribution have been reviewed.
