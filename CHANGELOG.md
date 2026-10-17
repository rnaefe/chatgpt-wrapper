# Changelog

## 0.5.0 — 2026-10-17

- Add image analysis and editing, requiring image references and the appropriate output artifacts.
- Wake the queue on committed task changes and add `wait_task` and `get_status` MCP tools.
- Export image artifacts as private local files with Markdown display/download links, including images over the inline limit.
- Separate browser image I/O, prompt contracts, DOM Markdown, MCP registration and metric aggregation into focused modules.
- Preserve task objectives and constraints in a JSON prompt envelope with capability-specific output expectations.
- Propagate task cancellation into remote image downloads; index task event history and avoid empty text artifacts for image-only results.
- Prevent reference attachments and streaming previews from being returned as finished generated images.
- Replace the silent onboarding video with a 40-second 1080p product film, original music and captions.

- Use `playwright-extra` for the browser runtime, retaining Playwright for browser installation and types.

- Guide setup through concise progress steps and verify the installed MCP connection before declaring completion.

- Add MCP usage and troubleshooting guides, contributor package map and GitHub reporting templates.
- Refuse automatic replacement of malformed or relative runtime entries.
- Correct README browser defaults and add package discovery/license metadata.

## 0.4.2 — 2026-10-17

- Default to Codex setup, including when no command is supplied.
- Upgrade recognized managed MCP entries without a replacement flag; stop only idle workers.
- Add `update` and `uninstall`, preserving other MCP entries and saved user data.
- Skip repeated sign-in for a ready worker and join sign-in already in progress.
- Reuse installed runtime files and keep Chromium installation output focused.
- Cover session expiry, interruptions, window closure, cancellation and recovery without prompt replay.
- Integrate image input boundaries, binary MCP images, output validation and task retention from upstream.

## 0.4.1 — 2026-10-17

- Close the visible browser after sign-in and after each task; reopen the saved profile on demand.

## 0.4.0 — 2026-10-17

- Add a CLI for setup, login, MCP, status and installation diagnostics.
- Configure Codex, Cursor and Claude Desktop with backups and explicit conflict handling.
- Install a versioned runtime outside the temporary npx cache.
- Build a standalone npm distribution with bundled workspace packages.
- Keep packaged runtime data in the user's application-data directory.
- Verify a packed npm install and MCP handshake in an isolated environment.

- Add explicit live browser verification with private PASS/BLOCKED/FAIL reports.
- Add safe idle-worker shutdown and visible-mode selection.
- Add local task metrics and recent error-code queries over CLI and MCP.

Live headless access remains blocked by provider verification in the recorded run. Automated worker upgrades remain separate work.
