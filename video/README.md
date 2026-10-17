# Wrapper product film

A 40-second Remotion film at 1920×1080 / 30 fps, with an original 120 BPM electronic score, a literal-wrapper cold open, a single-command installation scene, kinetic typography and real Wrapper outputs. The film is a designed product presentation, not an uncut screen recording.

## Evidence behind the film

- The TypeScript source and 10.6-second timing come from the existing recorded public provider run in `public/session.json`. This is one run, not a speed guarantee. The tool sequence shown is the current development workflow.
- `public/istanbul-cat.png` is an image generated through Wrapper for this development session. The display/download treatment is a conceptual presentation of the implemented delivery metadata.
- The 244 → 1.7 ms comparison is a twelve-task local fixture benchmark. It measures queue, validation and persistence, excluding browser startup and provider generation. See [performance evidence](../docs/PERFORMANCE.md).
- The six capabilities shown belong to the development source, not necessarily the published npm release. Image analysis and editing have schema/worker/browser fixture coverage. A live analysis probe could not confirm submission, and a subsequent read-only check encountered provider verification. The film does not claim live verification for those two modes.

No credentials, account UI, private prompts, or browser profiles are included. Text is self-contained without audio. Captions are generated from `public/storyboard.json`. The README leads with the four-second animated cold open, which links to the full film. The updated story replaces a local benchmark scene with the released npm install command; this installation scene is designed typography, not a live terminal recording.

## Render

```sh
cd video
npm ci
npm run typecheck
npm run studio
npm run render
npm run publish-assets
```

`publish-assets` renders the MP4, poster, four-second GIF, and captions into `docs/assets`. It checks 1080p dimensions, stereo audio and timeline duration. Set `REMOTION_BROWSER_EXECUTABLE` to an existing Chromium executable if needed. Fonts use `@remotion/google-fonts`; the initial render can require network access.

A gentler version removes transform animations while retaining fades:

```sh
npx remotion render src/Root.tsx WrapperDemo out/calm.mp4 --props='{"reducedMotion":true}'
```

## Music

`public/score.m4a` is an original procedural score created for this demo, with bass, percussion, arpeggios and scene accents. No third-party recordings or samples are used. The source is `scripts/score.py` (requires Python and NumPy). Rebuild it with:

```sh
python3 scripts/score.py
ffmpeg -y -i out/score.wav -af loudnorm=I=-16:TP=-1.5:LRA=8 -ar 48000 -c:a aac -b:a 192k public/score.m4a
```

The score is normalized to a target of -16 LUFS, then mixed at 80% in the film. Audio is AAC stereo; the MP4 uses H.264 with yuv420p. Assets and source are covered by the repository license.

## Capture another real code run

Build the root project, then explicitly select your private signed-in profile:

```sh
pnpm build
DEMO_SESSION_DIR=/absolute/path/to/private-data node video/scripts/capture.mjs
```

The capture script sends one fixed public TypeScript prompt and never resubmits it. It uses a separate temporary Codex config, preserves your normal config, and never copies your saved profile into this directory. Review `public/session.json` before sharing a new recording.

The original onboarding workflow drew from [Leihyn's demo-video skill](https://github.com/Leihyn/claude-demo-video-skill). The current film, visual system and score are maintained in this repository; no external skill files or recordings are vendored.

## Story and product framing

The cold open starts with the actual motivation: hitting Codex usage limits and literally wrapping the ChatGPT browser session. The setup scene shows the released v0.4.2 npm install command, followed by manual sign-in and Codex usage. The ending links to the source. The film does not claim that the official ChatGPT API is being used or that browser verification can be automated away.
