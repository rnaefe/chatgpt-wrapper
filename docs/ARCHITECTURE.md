# Architecture

MCP client → authenticated loopback transport → SQLite queue → single Playwright worker → ChatGPT UI → validated text/image artifacts → MCP client.

`apps/daemon` owns MCP, worker startup, onboarding, persistent browser lifecycle and the page engine. `mcp.ts` only starts the transport; `mcp-server.ts` registers tools without starting a daemon on import. `playwright-adapter.ts` manages the session and execution lifecycle; `browser-images.ts` validates, uploads and downloads images. `page-markdown.ts` serializes DOM content independently of the page execution state machine. `task-prompts.ts` owns the six output contracts and JSON task envelope. Image paths and raw base64 inputs are excluded from that envelope; only attachment order and names are described. Metric aggregation lives in `packages/core/src/metrics.ts`, apart from SQL persistence. `packages/contracts`, `packages/core`, `packages/adapters` and `packages/validation` provide schemas, persistence, adapter interfaces and result checks.

`pnpm connect` builds, installs Chromium if needed and starts the worker. Visible mode is the default: the worker opens a browser for manual authentication, saves the session, and closes the window. Each task reopens the saved profile and closes its context after completion, failure, or cancellation. `--headless` or `BROWSER_HEADLESS=true` opts into experimental headless verification and execution. `connect --visible` explicitly overrides the environment; stop a worker running in another mode before reconnecting. Concurrent CLI sign-in requests join the existing flow; queued tasks wait during onboarding. Closing the sign-in window or exceeding its deadline produces a recoverable error.

Visible tasks reopen the saved browser profile in a new context and close it after completion. Prompt submission occurs once. A completed assistant turn, absence of streaming controls, and stable text are required before delivery. Cancellation closes the task-owned context in either mode without deleting the saved profile. A task interrupted by a crash is terminal and never automatically replayed. Terminal tasks and unused artifacts are pruned according to `TASK_RETENTION_DAYS` (default: 30 days).

The client owns planning, repository access and applying code. The wrapper does not collect local source files. There is no dashboard, extension, native host or API-provider transport.

## CLI distribution

The root package builds `dist/cli.js`, `dist/daemon.js`, `dist/mcp.js`, and the browser page engine. Internal workspace packages are bundled; runtime npm dependencies remain external. End users need Node.js and npm, not pnpm or the repository.

Setup installs an exact package version under the private application-data directory and writes an absolute Node/CLI command into the chosen MCP client config. This keeps the server usable when npx removes its temporary package. Runtime profiles, database and logs live outside the installed package. Config merges preserve unrelated values and keep exact backups; formatting/comments may be normalized.

Development runtime paths and packaged runtime paths are resolved centrally in `runtime-paths.ts`. Only development loads the repository's `.env`; neither mode loads configuration from an arbitrary caller working directory.

The Chromium runtime is provided by `playwright-extra`; the underlying Playwright installation supplies browser binaries and types. No plugins are registered. Local Chromium fixture tests exercise the same persistent-context launcher as provider tasks. This integration does not establish headless access through provider verification.

## Queue scheduling and waiting

The store publishes task changes only after their SQLite transaction commits. The worker wakes on new submissions and drains the next queued task immediately after completion, while keeping a one-second readiness fallback for onboarding and changes from other store instances. Only one provider task runs at a time. Shutdown removes the subscription and aborts active execution.

`wait_task` uses an authenticated `GET /v1/tasks/:id/wait?waitMs=30000` request. It subscribes to terminal task changes instead of repeatedly reading SQLite, returns a current snapshot after the deadline, and removes its listener and timer on completion, timeout or client disconnection. These notifications are in-process; SQLite remains the durable source of truth. An index on `(task_id, seq)` keeps event-history reads scoped to the requested task.

The page engine waits for stable text and image sources with no active streaming controls. Uploaded references inside the user turn cannot be mistaken for generated outputs. Text-free image results do not create empty text artifacts.

## Prompt contracts

The task objective, acceptance criteria and output path scope are preserved as JSON rather than interpolated into ad hoc instruction lists. Each capability has its own output contract: code/diff, evidence-backed review findings, reasoned text, generated image, edited image or visual analysis. The task envelope is a formatting boundary, not protection against prompt injection. Validation still checks actual returned artifacts and never equates a provider claim with passing tests or meeting acceptance criteria. MCP initialization also explains the submit-once, wait, collect and review workflow to clients.

Image input downloads receive the task abort signal. Cancellation stops remote fetches as well as the task-owned browser context. The runtime registers no global browser plugins.
