# Architecture

MCP client → authenticated loopback transport → SQLite queue → single Playwright worker → ChatGPT UI → validated text/image artifacts → MCP client.

`apps/daemon` owns MCP, worker startup, onboarding, persistent browser lifecycle and the page engine. `packages/contracts`, `packages/core`, `packages/adapters` and `packages/validation` provide schemas, persistence, adapter interfaces and result checks.

`pnpm connect` builds, installs Chromium if needed and starts the worker. Visible mode is the default: the worker opens a browser for manual authentication, saves the session, and closes the window. Each task reopens the saved profile and closes its context after completion, failure, or cancellation. `--headless` or `BROWSER_HEADLESS=true` opts into experimental headless verification and execution. `connect --visible` explicitly overrides the environment; stop a worker running in another mode before reconnecting. Concurrent sign-in is rejected; queued tasks wait during onboarding. Closing the sign-in window or exceeding its deadline produces a recoverable error.

Visible tasks reuse the connected browser and navigate to a fresh conversation. Prompt submission occurs once. A completed assistant turn, absence of streaming controls, and stable text are required before delivery. Cancellation closes the owned context and releases its profile lock. A task interrupted by a crash is terminal and never automatically replayed.

The client owns planning, repository access and applying code. The wrapper does not collect local source files. There is no dashboard, extension, native host or API-provider transport.

## CLI distribution

The root package builds `dist/cli.js`, `dist/daemon.js`, `dist/mcp.js`, and the browser page engine. Internal workspace packages are bundled; runtime npm dependencies remain external. End users need Node.js and npm, not pnpm or the repository.

Setup installs an exact package version under the private application-data directory and writes an absolute Node/CLI command into the chosen MCP client config. This keeps the server usable when npx removes its temporary package. Runtime profiles, database and logs live outside the installed package. Config merges preserve unrelated values and keep exact backups; formatting/comments may be normalized.

Development runtime paths and packaged runtime paths are resolved centrally in `runtime-paths.ts`. Only development loads the repository's `.env`; neither mode loads configuration from an arbitrary caller working directory.
