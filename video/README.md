# Wrapper onboarding demo

A 38-second, silent Remotion composition at 1920×1080 / 30 fps. It uses captured development-build CLI output and a real public MCP task result, rendered into terminal panels. This is not a desktop screen recording.

The footage uses a saved ChatGPT session. First-login UI is not shown. Local paths and install chatter are omitted; idle time is shortened. The CLI presentation is an unreleased preview, while the closing install command points to the existing 0.4.2 release.

## Render the captured run

```sh
cd video
npm ci
npm run studio
npm run render
```

`npm run poster` renders a static frame. The captured public output is in `public/session.json`; rendering it does not access an account. Fonts are loaded using `@remotion/google-fonts`. The first render may need network access to obtain fonts and a compatible browser. `--browser-executable=/absolute/path/to/chrome` can select an existing browser.

## Capture another real run

Build the root project, then explicitly select your private signed-in profile:

```sh
pnpm build
DEMO_SESSION_DIR=/absolute/path/to/private-data node video/scripts/capture.mjs
```

Optionally set `DEMO_SESSION_PORT` (default 11435). Capture sends one fixed public TypeScript prompt to ChatGPT; it never retries the prompt. It tests setup against a separate temporary Codex config and removes that test data afterwards. It does not modify your normal Codex config or copy/export your saved session. Confirm you are allowed to automate the selected account.

Review `public/session.json` before sharing it. It should contain only selected CLI status lines and the public task result, never a token, profile, private prompt or account screenshot.

## Assets and accessibility

The README uses a static poster by default and puts the animated GIF behind an explicit disclosure. The MP4 has no voiceover or music; scene text provides the explanation. `captions.vtt` supplies an optional text track. Downloadable video and GIF files live in `docs/assets` and are excluded from the npm distribution.

The workflow follows [Leihyn's demo-video skill](https://github.com/Leihyn/claude-demo-video-skill), adapted to a short terminal-first walkthrough. No skill files or external recordings are vendored. Video source and scripts are maintained separately from the product's runtime dependencies.
