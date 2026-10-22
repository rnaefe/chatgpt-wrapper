# Troubleshooting

Start with:

```sh
npx -y @rnaefe/chatgpt-wrapper@latest doctor
```

`doctor` checks paths and whether the recorded worker PID is alive. It does not prove that ChatGPT is reachable or signed in. `status` starts the local worker if needed and reports browser state. Use the same `--data-dir` and `--port` as a custom installation.

## Wrapper does not appear in the client

Restart the MCP client after setup or update. Check setup's printed config path. Codex is the default; other clients require `--client`. Run setup again to repair the entry. Existing managed entries are recognized; unrelated entries require `--replace` and receive a backup.

If configuration is malformed, Wrapper refuses to overwrite it. Fix that file first, or test with `--config /absolute/path/to/a/separate/config.toml`.

## Sign-in or verification is required

```sh
npx -y @rnaefe/chatgpt-wrapper@latest connect
```

Finish sign-in in the visible window. It closes when setup succeeds. If the worker still reports ready but the saved session needs attention, use `connect --force-login`. Do not put passwords, cookies or verification codes in issues.

Headless access is experimental. If it is blocked, stop an idle worker and select visible execution:

```sh
npx -y @rnaefe/chatgpt-wrapper@latest stop
npx -y @rnaefe/chatgpt-wrapper@latest connect --visible
```

For a managed client installation, rerun `setup --visible` to save that mode in the client entry, then restart the client. Repeated sign-in is not a confirmed solution for a headless challenge.

## Worker busy, profile locked or port occupied

Finish or cancel unfinished tasks before an update or stop. Wrapper will not stop a worker with queued, running or validating work. Close another process using the same private profile. Do not delete a live worker's lock file.

A worker using another data directory may own the default port. Select a different `--port` during setup. Never share a profile between simultaneous workers.

## A task stopped unexpectedly

Inspect it with `get_task` or `list_errors`. `WORKER_RESTARTED`, `WORKER_STOPPED`, `BROWSER_INTERRUPTED` and `DEADLINE_EXCEEDED` do not trigger automatic resubmission. The provider may already have received the prompt. Review the task before sending a new one.

`VALIDATION_FAILED` can mean the provider returned plain prose for a code-generation request, an unsafe diff path or an oversized result. Ask for an explicit code block or use `reason.analyze` for prose analysis.

## Existing text or attachments block a task

`UNSENT_DRAFT` and `UNSENT_ATTACHMENTS` mean the target composer already contains unsent user material. Wrapper leaves it intact and does not send it with a new task. Review the saved browser profile manually, save or clear that draft yourself, then explicitly submit a new task. A failed upload can leave draft attachment cards; remove them manually before continuing that conversation. There is no automatic retry or draft deletion.

## Document inputs or research are unavailable

Local document/source paths require absolute directories in `FILE_INPUT_ROOTS` in the worker environment; restart the worker after changing it. Images still use `IMAGE_INPUT_ROOTS`. MIME/extension checks and basic PDF/DOCX header validation happen before upload. `ATTACHMENT_UPLOAD_FAILED` stops before prompt submission when upload completion cannot be confirmed.

`RESEARCH_UNAVAILABLE` means Search could not be visibly selected. Review the account's tools in the visible browser. Ordinary analysis is not substituted silently. Research source extraction checks link syntax, not claim accuracy.

## Image inputs are rejected

Image file paths need an explicit trusted absolute root in `IMAGE_INPUT_ROOTS`; symlink escapes are rejected. URL inputs need an exact trusted host in `ALLOWED_IMAGE_HOSTS`; redirects and nonstandard ports are rejected. See [security](SECURITY.md) before broadening an allowlist.

## Report a reproducible problem

Include Wrapper and Node versions, client, browser mode, the error code and a small public reproduction. State whether it happened with a fixture or a real account. Logs may contain private data: inspect and redact them locally. Never attach `.data`, a browser profile, a token, a task database or account screenshots. Use the [bug form](https://github.com/rnaefe/chatgpt-wrapper/issues/new?template=bug_report.yml).
