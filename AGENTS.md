# Coding agent instructions

Read docs/ARCHITECTURE.md, docs/ROADMAP.md and docs/SECURITY.md.

Product direction: fully automated MCP -> queue -> worker -> normalized result, not manual copy/paste. A Playwright ChatGPT web adapter is **experimental and gated on provider authorization/terms review**. Do not ship or activate prohibited web output extraction. Never implement CAPTCHA bypass, stealth/fingerprint spoofing, quota evasion, session cookie extraction, or undocumented private endpoints. Use authorized API/local adapters for deployable automation.

Keep modules small, typed and testable. Explicitly distinguish planned architecture from implemented features. Existing HTTP prototype is not production-ready.
