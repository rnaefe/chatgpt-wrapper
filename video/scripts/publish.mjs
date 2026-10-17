import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const video = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = resolve(video, "../docs/assets");
const cli = join(video, "node_modules/@remotion/cli/remotion-cli.js");
const browser = process.env.REMOTION_BROWSER_EXECUTABLE;
const browserArgs = browser ? [`--browser-executable=${browser}`] : [];
const storyboard = JSON.parse(
  readFileSync(join(video, "public/storyboard.json"), "utf8"),
);
mkdirSync(assets, { recursive: true });

function remotion(args) {
  execFileSync(process.execPath, [cli, ...args, ...browserArgs], {
    cwd: video,
    stdio: "inherit",
  });
}
remotion([
  "render",
  "src/Root.tsx",
  "WrapperDemo",
  join(assets, "wrapper-demo.mp4"),
  "--concurrency=4",
  "--codec=h264",
  "--crf=18",
  "--pixel-format=yuv420p",
]);
remotion([
  "still",
  "src/Root.tsx",
  "WrapperDemo",
  join(assets, "wrapper-demo.png"),
  "--frame=80",
]);
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    join(assets, "wrapper-demo.mp4"),
    "-t",
    "4",
    "-filter_complex",
    "fps=12,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=bayer",
    "-loop",
    "0",
    join(assets, "wrapper-demo.gif"),
  ],
  { stdio: "inherit" },
);
let start = 0;
const timestamp = (seconds) =>
  new Date(seconds * 1000).toISOString().slice(11, 23);
const captions = storyboard.map((scene) => {
  const cue = `${timestamp(start)} --> ${timestamp(start + scene.seconds)}\n${scene.caption}`;
  start += scene.seconds;
  return cue;
});
writeFileSync(
  join(assets, "captions.vtt"),
  `WEBVTT\n\n${captions.join("\n\n")}\n`,
);
const probe = JSON.parse(
  execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      join(assets, "wrapper-demo.mp4"),
    ],
    { encoding: "utf8" },
  ),
);
if (
  !probe.streams.some(
    (stream) => stream.codec_type === "audio" && stream.channels === 2,
  )
)
  throw Error("Video is missing its stereo score");
if (
  !probe.streams.some(
    (stream) =>
      stream.codec_type === "video" &&
      stream.width === 1920 &&
      stream.height === 1080,
  )
)
  throw Error("Expected a 1080p video");
if (Math.abs(Number(probe.format.duration) - start) > 0.1)
  throw Error("Video duration and captions disagree");
console.log(
  `Published ${start}s / 1080p / stereo audio, poster, GIF and captions to docs/assets.`,
);
