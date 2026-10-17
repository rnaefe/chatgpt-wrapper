import React from "react";
import {
  AbsoluteFill,
  Audio,
  Composition,
  Series,
  registerRoot,
  staticFile,
} from "remotion";
import { Calm } from "./design";
import {
  Code,
  Intro,
  Workflow,
  ImageResult,
  Capabilities,
  Speed,
  Outro,
} from "./scenes";
import { duration, fps, scenes } from "./constants";

const parts = [Intro, Workflow, Code, ImageResult, Capabilities, Speed, Outro];
function Demo({ reducedMotion = false }: { reducedMotion?: boolean }) {
  return (
    <Calm.Provider value={reducedMotion}>
      <AbsoluteFill>
        <Audio src={staticFile("score.m4a")} volume={0.8} />
        <Series>
          {parts.map((Part, index) => (
            <Series.Sequence key={index} durationInFrames={scenes[index] * fps}>
              <Part />
            </Series.Sequence>
          ))}
        </Series>
      </AbsoluteFill>
    </Calm.Provider>
  );
}
function Root() {
  return (
    <Composition
      id="WrapperDemo"
      component={Demo}
      durationInFrames={duration}
      fps={fps}
      width={1920}
      height={1080}
      defaultProps={{ reducedMotion: false }}
    />
  );
}
registerRoot(Root);
