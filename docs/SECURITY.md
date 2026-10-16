# Security and provider constraints

## Hard requirements
- Do not ask for, log, export, sync or commit ChatGPT passwords, cookies or session tokens.
- User performs initial authentication in their own local browser. Protect persistent browser profile with OS file permissions.
- Never bypass CAPTCHA, bot checks, rate limits, subscription limits or account blocks; pause and surface NEEDS_HUMAN or BLOCKED_BY_PROVIDER.
- Do not use undocumented ChatGPT internal APIs, stealth fingerprinting or account rotation.
- ChatGPT consumer web automation/output extraction may violate provider terms; disable experimental browser adapter until permission/terms review is resolved.
- Local HTTP binds loopback; add authentication, Origin validation and DNS-rebinding defenses before dashboard exposure.
- Treat model responses and images as untrusted; validate artifacts, file paths and patch syntax.
- Never run generated shell commands or patch repositories automatically without explicit scoped approval.
- Redact secrets; user must authorize any code/files shared with an external service.
- Store provenance, consent and task history with retention controls.
- Do not claim actual Plus usage limits can be read from the web UI reliably.
