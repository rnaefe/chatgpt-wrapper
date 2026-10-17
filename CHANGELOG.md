# Changelog

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
