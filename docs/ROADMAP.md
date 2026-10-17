# Priorities

## 1. CLI installation

Implemented in 0.4.0: single-command setup, persistent npm runtime, Chromium installation, Codex configuration with backups, and login. Cursor and Claude Desktop configuration writers are also available.

Verified locally: clean tarball installation, preservation of unrelated Codex settings, actual Codex CLI recognition, and a packaged MCP handshake after removing the temporary bootstrap installation. Published `@rnaefe/chatgpt-wrapper@0.4.0` on 2026-10-17. A clean registry install, persistent runtime setup and seven-tool MCP handshake passed. The registry CLI reopened the saved visible session; a task through the existing Codex integration completed in 11.5 seconds.

## 2. Browser reliability

Visible execution has previously completed a live MCP coding task. Headless execution has encountered a provider browser-verification screen. Package smoke tests do not access an account or claim to verify provider reliability.

Implemented: an explicitly invoked, sequential live MCP verification command and private outcome reports. On 2026-10-17, two visible probes passed; headless was blocked by browser verification before submission. See BROWSER_RELIABILITY.md. Cross-platform and extended-session acceptance remain unverified.

## 3. Observability

Implemented: authenticated CLI/HTTP/MCP queries for duration distributions, success rate, outcome counts and recent error codes. Prompts and responses are excluded from metrics. See OBSERVABILITY.md for definitions. Retention controls and alerts remain unimplemented.

## 4. Release

Version 0.4.1 is public on npm with on-demand browser windows. Its registry integrity matched the release artifact; clean registry installation, Codex config merge and the seven-tool MCP handshake passed on macOS.

Standalone npm bundling, version metadata, changelog, installation docs and a package smoke test are implemented. Version 0.4.0 is public on npm; registry installation was verified on macOS. Cross-platform acceptance tests remain separate work. No CI workflow is included.
