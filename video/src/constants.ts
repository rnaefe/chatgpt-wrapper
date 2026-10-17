import storyboard from "../public/storyboard.json";
export const colors = {
  background: "#ecebe7",
  surface: "#e1dfd9",
  ink: "#38450f",
  muted: "#5d683a",
};
export const type = { small: 20, body: 30, lead: 40, head: 104, display: 250 };
export const scenes = storyboard.map((scene) => scene.seconds);
export const fps = 30;
export const duration = scenes.reduce((sum, seconds) => sum + seconds, 0) * fps;
