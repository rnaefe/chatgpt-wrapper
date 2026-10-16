# Security baseline

- Never collect ChatGPT session cookies, passwords, or authentication tokens.
- Do not scrape ChatGPT web responses or call undocumented internal endpoints.
- Keep local HTTP bound to loopback. Before adding browser/dashboard clients, implement authentication, Origin checks and DNS rebinding protection.
- Imported output is untrusted. Never execute imported code without explicit approval and sandboxing.
- Do not send private files to external services without review.
- The current in-memory proof of concept is development-only, not production-ready.
