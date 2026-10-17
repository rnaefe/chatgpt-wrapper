# ChatGPT Wrapper

A local MCP server that sends coding and analysis tasks to ChatGPT through a visible Playwright browser and returns completed responses as Markdown.

**Experimental.** Initial sign-in is visible; subsequent tasks run headlessly by default. Headless execution may encounter provider browser verification. A live MCP code task completed in visible mode on 2026-10-17. Set `BROWSER_HEADLESS=false` for visible tasks if headless execution is blocked; do not attempt to bypass browser verification.

## Connect once

Requires Node.js 24+ and pnpm 10.

```sh
pnpm install
pnpm connect
```

A browser opens for you to sign in. Wrapper detects sign-in, verifies the saved session, and then runs tasks headlessly in the background by default. The local worker starts automatically. Repeat `pnpm connect` if your session expires. You do not need to close windows manually or start a separate daemon.

## Add to your MCP client

```json
{
  "mcpServers": {
    "wrapper": {
      "command": "node",
      "args": ["/absolute/path/to/chatgpt-wrapper/apps/daemon/dist/mcp.js"]
    }
  }
}
```

The launcher starts the shared local worker and handles local authentication.

| Tool           | Purpose                                    |
| -------------- | ------------------------------------------ |
| `submit_task`  | Queue a task and return its ID             |
| `get_task`     | Read status, result and event history      |
| `list_tasks`   | List tasks, with optional status filtering |
| `cancel_task`  | Cancel queued or running work              |
| `get_artifact` | Read a stored text result                  |

Example `submit_task` arguments:

```json
{
  "capability": "code.review",
  "objective": "Review this function for edge cases: const divide = (a, b) => a / b;",
  "acceptanceCriteria": ["Explain division by zero behavior"],
  "timeoutSeconds": 120
}
```

Poll the returned ID with `get_task`. A nonempty response is not enough: the worker waits for a completed assistant turn before returning it. Results preserve Markdown and code fences. The client decides whether to apply generated code; Wrapper never edits your repository or executes generated commands.

Tasks may include up to eight image inputs using a local path, base64 data, or an HTTPS URL. For safety, local paths require an explicit `IMAGE_INPUT_ROOTS` allowlist and HTTPS URLs require an explicit `ALLOWED_IMAGE_HOSTS` allowlist in `.env`. Base64 inputs require neither allowlist:

```json
{
  "capability": "reason.analyze",
  "objective": "Describe the layout and accessibility issues in this screenshot.",
  "images": [{ "source": "path", "path": "/absolute/path/to/screenshot.png" }]
}
```

Generated images are stored as authenticated image artifacts alongside the text result. Image files are limited to 10 MiB each.

Use the dedicated `image.generate` capability when an image must be created:

```json
{
  "capability": "image.generate",
  "objective": "Create a minimal watercolor illustration of a mountain lake at sunset."
}
```

## Local configuration

No `.env` is required for text tasks. Optional settings: `DATA_DIR`, `PORT` (default 11435), and `BROWSER_HEADLESS=false` to keep task execution visible. To allow local image inputs, set `IMAGE_INPUT_ROOTS` to a comma-separated list of trusted absolute directories; symlink escapes are rejected. To allow HTTPS image URL inputs, set `ALLOWED_IMAGE_HOSTS` to comma-separated exact trusted hostnames (no wildcards or redirects). `TASK_RETENTION_DAYS` defaults to 30 and accepts 0 (disable) through 3650. Authentication lives in a separate private profile under `.data/playwright-profile`; it is never imported from your everyday browser or exported. Keep this directory private.

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

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and [security notes](docs/SECURITY.md) for credential handling. Licensed under the [GNU GPL v3](LICENSE).
