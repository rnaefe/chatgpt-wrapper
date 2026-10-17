import storyboard from "../public/storyboard.json";
export const colors = {
  background: "#0a0c11",
  panel: "#141820",
  text: "#f2f0e8",
  muted: "#a2a8b4",
  accent: "#d2ff5a",
  violet: "#aaa2ff",
  line: "#303643",
};
export const scenes = storyboard.map((scene) => scene.seconds);
export const fps = 30;
export const duration = scenes.reduce((sum, seconds) => sum + seconds, 0) * fps;
