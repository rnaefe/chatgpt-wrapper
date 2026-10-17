# Security and privacy

Wrapper automates an authenticated, user-owned browser session through an MCP client. MCP is a transport, not a grant of permission to use a third-party service. Confirm that browser automation and any public distribution are permitted by the provider before using or releasing this project. Wrapper does not bypass login, verification challenges, usage limits, or access controls.

## Local threat model

- The daemon binds to `127.0.0.1`. All non-health endpoints require a random, local bearer token. Requests with hostile `Host` or `Origin` headers are rejected.
- Treat MCP clients as privileged: they can submit prompts, request approved image inputs, and retrieve task history and artifacts. Do not expose the local HTTP service, MCP stdio process, token file, or browser profile to untrusted users.
- The separate `.data/playwright-profile` contains authenticated cookies. Keep it private. Never upload it, a `.env` file, API tokens, `.data/tasks.sqlite`, or artifact files.
- Image file-path inputs are disabled unless `IMAGE_INPUT_ROOTS` contains explicit absolute directories. Paths are resolved before the scope check to reject symlink escapes. Avoid setting `/` or your entire home directory.
- HTTPS image URL downloads are disabled unless `ALLOWED_IMAGE_HOSTS` lists exact trusted hostnames. Redirects and nonstandard ports are rejected. Hosts on this list are trusted to serve safe responses; do not add untrusted domains.
- Prompts, results and images may be sent to the selected provider. Do not submit private source, credentials or sensitive records unless you have permission and an appropriate data-handling basis.
- Result validation checks bounds, basic code structure and output patch paths; it does **not** sandbox or establish the correctness or safety of generated code. The calling agent or user must review changes before applying them.

## Data retention

By default the worker periodically removes terminal tasks older than 30 days and deletes artifacts no longer referenced by retained tasks. Queued and running tasks are never deleted by retention. Configure `TASK_RETENTION_DAYS=0` to disable expiry, or set 1–3650 days. A stopped daemon cannot run cleanup; old data can remain until the next start. Credentials, the browser profile and daemon logs are **not** included in task retention. To erase all local data, stop the daemon and remove the configured `DATA_DIR` directory.

## Responsible reporting

Report security vulnerabilities privately to the repository maintainer rather than publishing an exploit, credentials, or session artifacts in a public issue. Do not use this project to circumvent provider verification, rate limits, account limits or other protective systems.
