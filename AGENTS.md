# Coding agent instructions

Read docs/ARCHITECTURE.md, docs/ROADMAP.md and docs/SECURITY.md.

Product direction: a standalone, client-agnostic tool exposing ChatGPT capabilities through MCP and HTTP: client -> queue -> worker -> normalized result. Claude Code, Gemini CLI, Codex, Cursor, custom agents and scripts are equal clients; do not build a Codex-specific orchestrator or require any client-specific SDK. The wrapper never owns agent planning or downstream patch application. A Playwright ChatGPT web adapter is **experimental and gated on provider authorization/terms review**. Do not ship or activate prohibited web output extraction. Never implement CAPTCHA bypass, stealth/fingerprint spoofing, quota evasion, session cookie extraction, or undocumented private endpoints. Use authorized API/local adapters for deployable automation.

Keep modules small, typed and testable. Explicitly distinguish planned architecture from implemented features. Existing HTTP prototype is not production-ready.
