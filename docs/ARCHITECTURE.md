# Architecture

MCP client → authenticated loopback transport → SQLite queue → single Playwright worker → ChatGPT UI → validated text/image artifacts → MCP client.

`apps/daemon` owns MCP, worker startup, onboarding, persistent browser lifecycle and the page engine. `mcp.ts` only starts the transport; `mcp-server.ts` registers tools without starting a daemon on import. `playwright-adapter.ts` manages the session and execution lifecycle; `browser-images.ts` validates, uploads and downloads images. `page-markdown.ts` serializes DOM content independently of the page execution state machine. `task-prompts.ts` owns the capability-specific output contracts and JSON task envelope. Attachment paths and raw base64 inputs are excluded from that envelope; only attachment order and names are described. Metric aggregation lives in `packages/core/src/metrics.ts`, apart from SQL persistence. `packages/contracts`, `packages/core`, `packages/adapters` and `packages/validation` provide schemas, persistence, adapter interfaces and result checks.

`pnpm connect` builds, installs Chromium if needed and starts the worker. Visible mode is the default: the worker opens a browser for manual authentication, saves the session, and closes the window. Each task reopens the saved profile and closes its context after completion, failure, or cancellation. `--headless` or `BROWSER_HEADLESS=true` opts into experimental headless verification and execution. `connect --visible` explicitly overrides the environment; stop a worker running in another mode before reconnecting. Concurrent CLI sign-in requests join the existing flow; queued tasks wait during onboarding. Closing the sign-in window or exceeding its deadline produces a recoverable error.

Visible tasks reopen the saved browser profile in a new context and close it after completion. Prompt submission occurs once. A completed assistant turn, absence of streaming controls, and stable text are required before delivery. Cancellation closes the task-owned context in either mode without deleting the saved profile. A task interrupted by a crash is terminal and never automatically replayed. Terminal tasks and unused artifacts are pruned according to `TASK_RETENTION_DAYS` (default: 30 days).

The client owns planning and applying code. The wrapper does not scan repositories. Explicit `files` inputs can read selected files under configured `FILE_INPUT_ROOTS` and upload them as provider attachments. `browser-files.ts` resolves and validates these inputs; combined image/document uploads use one file-input operation. There is no dashboard, extension, native host or API-provider transport.

Batch APIs store task IDs in a durable SQLite batch record. All task insertions and the batch commit atomically before worker notifications, using the existing single worker. `get_batch` aggregates current task results without replaying work; partially expired batches identify missing tasks, and fully expired batches are removed during retention.

`research.search` first verifies a visibly active Search tool using `browser-research.ts`. The page engine preserves source anchors from the new assistant turn; validation requires at least one HTTP(S) link and extracts at most 50 deduplicated source records. Sources are observed provider links, not independently verified evidence.

## CLI distribution

The root package builds `dist/cli.js`, `dist/daemon.js`, `dist/mcp.js`, and the browser page engine. Internal workspace packages are bundled; runtime npm dependencies remain external. End users need Node.js and npm, not pnpm or the repository.

Setup installs an exact package version under the private application-data directory and writes an absolute Node/CLI command into the chosen MCP client config. This keeps the server usable when npx removes its temporary package. Runtime profiles, database and logs live outside the installed package. Config merges preserve unrelated values and keep exact backups; formatting/comments may be normalized.

Development runtime paths and packaged runtime paths are resolved centrally in `runtime-paths.ts`. Only development loads the repository's `.env`; neither mode loads configuration from an arbitrary caller working directory.

The Chromium runtime is provided by `playwright-extra`; the underlying Playwright installation supplies browser binaries and types. No plugins are registered. Local Chromium fixture tests exercise the same persistent-context launcher as provider tasks. This integration does not establish headless access through provider verification.

## Queue scheduling and waiting

The store publishes task changes only after their SQLite transaction commits. The worker wakes on new submissions and drains the next queued task immediately after completion, while keeping a one-second readiness fallback for onboarding and changes from other store instances. Only one provider task runs at a time. Shutdown removes the subscription and aborts active execution.

`wait_task` uses an authenticated `GET /v1/tasks/:id/wait?waitMs=30000` request. It subscribes to terminal task changes instead of repeatedly reading SQLite. With optional `afterProgressRevision`, it also returns when a newer progress revision is committed. It returns a current snapshot after the deadline and removes its listener and timer on a matching change, timeout or client disconnection. These notifications are in-process; SQLite remains the durable source of truth. An index on `(task_id, seq)` keeps event-history reads scoped to the requested task.

Tasks carry an optional progress snapshot; older records remain readable without migration. Stage changes update task JSON and append an event in one transaction before notifying subscribers. The worker receives adapter callbacks; a main-frame Playwright binding relays observed prompt submission and response milestones from the page engine. Messages use fixed labels and exclude provider content. Terminal tasks ignore late progress and retain their last stage on failure or cancellation. The CLI `watch <task-id>` uses the same revision-based wait; interrupting it aborts only the local request.

The page engine waits for stable text and image sources with no active streaming controls. Uploaded references inside the user turn cannot be mistaken for generated outputs. Text-free image results do not create empty text artifacts.

## Prompt contracts

The task objective, acceptance criteria and output path scope are preserved as JSON rather than interpolated into ad hoc instruction lists. Each capability has its own output contract: code/diff, evidence-backed review findings, reasoned text, generated image, edited image or visual analysis. The task envelope is a formatting boundary, not protection against prompt injection. Validation still checks actual returned artifacts and never equates a provider claim with passing tests or meeting acceptance criteria. MCP initialization also explains the submit-once, wait, collect and review workflow to clients.

Image input downloads receive the task abort signal. Cancellation stops remote fetches as well as the task-owned browser context. The runtime registers no global browser plugins.

## Model selection and conversation continuity

Version 0.6.0 accepts optional `model` and `conversationId` request fields. Model labels are trimmed, limited to 1–100 characters without control characters, and matched to the exact visible browser picker label. There is no model-name enum or configured default. Conversation IDs are UUIDs canonicalized to lowercase; callers cannot provide navigation URLs or paths.

Without a conversation ID, execution prepares a fresh chat. Without a model label, it retains the browser's selection. Explicit selection reports `selecting_model` after `preparing_chat` and before image upload. A missing model or unverifiable conversation stops execution before prompt submission, with no fallback conversation, alternative model, or automatic prompt retry.

Adapter outputs and task results can carry optional `conversationId` and `conversationUrl` metadata. Clients use the returned conversation ID for a later task; the queue's task ID remains a separate identifier. Both request fields participate in idempotency comparisons. Older requests and stored results remain valid without these optional fields. Browser fixtures verify local behavior only and do not guarantee live provider continuity or model availability.
