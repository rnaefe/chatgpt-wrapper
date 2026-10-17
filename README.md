# ChatGPT Wrapper

A local MCP server that sends coding and analysis tasks to ChatGPT through a visible Playwright browser and returns completed responses as Markdown.

**Experimental.** Initial sign-in is visible; subsequent tasks run headlessly by default. Headless execution may encounter provider browser verification. A live MCP code task completed in visible mode on 2026-10-17. Set `BROWSER_HEADLESS=false` for visible tasks if headless execution is blocked; do not attempt to bypass browser verification.

## Install through the CLI

Install version `0.4.2` from npm and configure Codex:

```sh
npx -y @rnaefe/chatgpt-wrapper@0.4.2
```

Requires Node.js 24+ and npm. Setup installs Chromium, adds Wrapper to your MCP client, and opens ChatGPT for manual sign-in. Restart your MCP client after setup. The browser closes after sign-in and opens only while a task runs. No repository clone or config editing is needed.

Codex is the primary setup target. `--client cursor` and `--client claude-desktop` are also supported. Existing settings are backed up. Wrapper recognizes and upgrades its own runtime entry; replacing an unrelated entry requires `--replace`.

See the [installation guide and local tarball testing](docs/INSTALLATION.md). The unscoped npm name `chatgpt-wrapper` belongs to another package.

To upgrade, run `npx -y @rnaefe/chatgpt-wrapper@latest update`, then restart your MCP client. The update stops an idle worker and preserves the saved session. `uninstall` removes the selected client entry with a backup and preserves local data.

For development from this repository:

```sh
pnpm install
pnpm connect
```

## MCP tools

The client uses the persistent installed runtime, not an npx cache directory. The launcher starts the shared worker and handles local authentication.

| Tool           | Purpose                                    |
| -------------- | ------------------------------------------ |
| `submit_task`  | Queue a task and return its ID             |
| `get_task`     | Read status, result and event history      |
| `list_tasks`   | List tasks, with optional status filtering |
| `cancel_task`  | Cancel queued or running work              |
| `get_artifact` | Read a stored result                       |
| `get_metrics`  | Success rate, durations and error counts   |
| `list_errors`  | Recent task IDs, statuses and error codes  |

Submit a task and poll its ID with `get_task`. Wrapper returns completed responses; the client decides whether to apply generated code. Wrapper never executes generated commands or applies patches.

## Local configuration

No `.env` is required. Packaged installations store data in the OS application-data directory; development uses `.data`. Optional settings: `DATA_DIR`, `PORT` (default 11435), and `BROWSER_HEADLESS=true` to opt into experimental headless execution. Image inputs require explicit `IMAGE_INPUT_ROOTS` directories or `ALLOWED_IMAGE_HOSTS` HTTPS hosts. Terminal task history expires after `TASK_RETENTION_DAYS` (default 30; 0 disables expiry). Authentication lives in a separate private profile under `.data/playwright-profile`; it is never imported from your everyday browser or exported. Keep this directory private.

The worker uses an authenticated loopback transport internally so MCP clients share one SQLite queue. One task runs at a time; sign-in pauses task dispatch. Interrupted or ambiguous submissions are never replayed automatically.

Login expiration, browser challenges, and account limits require user intervention. No CAPTCHA bypass, stealth, cookie export, private endpoints, or quota evasion. Use only within your provider authorization. Image upload and generated-image extraction depend on the provider UI exposing the corresponding controls.

## Development

```sh
pnpm browser:install
pnpm check
```

Tests cover the durable queue, MCP, cancellation, browser lifecycle, onboarding, completion detection, and the shared engine in a real headless Chromium fixture. Chromium must be installed (`pnpm browser:install`) for that fixture. A live authenticated provider test is separate from fixture verification.

## Troubleshooting

| State or error         | Next step                                                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HEADLESS_CHALLENGE`   | ChatGPT requires browser verification in headless mode. Repeated sign-in is not a confirmed fix; optionally try `BROWSER_HEADLESS=false`, restart the worker, and reconnect |
| `NEEDS_AUTH`           | Run `pnpm connect` to sign in                                                                                                                                               |
| `NEEDS_HUMAN`          | Review the reported error; successful visible login does not guarantee headless access                                                                                      |
| `BLOCKED_BY_PROVIDER`  | Review account access or wait for the provider limit to reset                                                                                                               |
| `BROWSER_START_FAILED` | Install Chromium and close another process using the same Wrapper profile                                                                                                   |
| `WORKER_RESTARTED`     | Review the previous task before submitting a new one; it was not replayed                                                                                                   |

Terminal task history and unreferenced artifacts are pruned after the configured retention period. Browser credentials, logs and other runtime files remain until manually deleted. Stop the worker before deleting its data directory; deleting the profile requires a new sign-in. Image artifacts returned by `get_artifact` use standard MCP base64 image content; large artifacts may require authenticated HTTP retrieval.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and [installation guide](docs/INSTALLATION.md) for credential handling. Licensed under the [GNU GPL v3](LICENSE).

Live browser results and repeatable checks: [browser reliability](docs/BROWSER_RELIABILITY.md). Task duration and success-rate definitions: [observability](docs/OBSERVABILITY.md).
