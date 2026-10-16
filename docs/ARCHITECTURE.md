# Architecture

MCP client → authenticated loopback transport → SQLite queue → single headless Playwright worker → ChatGPT UI → validated text/image artifacts → MCP client.

`apps/daemon` owns MCP, worker startup, onboarding, persistent browser lifecycle and the page engine. `packages/contracts`, `packages/core`, `packages/adapters` and `packages/validation` provide schemas, persistence, adapter interfaces and result checks.

`pnpm connect` builds, installs Chromium if needed and starts the worker. The worker opens a visible browser for manual authentication, verifies the saved profile, then closes that window and runs MCP tasks headlessly by default. Set `BROWSER_HEADLESS=false` to keep task execution visible for troubleshooting. Concurrent sign-in is rejected; queued tasks wait during onboarding. Closing the sign-in window or exceeding its deadline produces a recoverable error.

Visible tasks reuse the connected browser and navigate to a fresh conversation. Prompt submission occurs once. A completed assistant turn, absence of streaming controls, and stable text are required before delivery. Cancellation closes the owned context and releases its profile lock. A task interrupted by a crash is terminal and never automatically replayed.

The client owns planning, repository access and applying code. The wrapper does not collect local source files. There is no dashboard, extension, native host or API-provider transport.
