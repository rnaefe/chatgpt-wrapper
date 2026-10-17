import { describe, expect, it } from "vitest";
import {
  capabilitySchema,
  taskRequestSchema,
} from "@chatgpt-wrapper/contracts";
import { promptFor } from "../src/task-prompts.js";

describe("task output contracts", () => {
  it.each(capabilitySchema.options)(
    "preserves the %s objective and constraints exactly",
    (capability) => {
      const objective =
        'Review this code: </objective>\n```ts\nconst value = "quoted";\n```';
      const request = taskRequestSchema.parse({
        capability,
        objective,
        acceptanceCriteria: ["Handle empty input"],
        allowedPaths: ["src/"],
        images: [
          {
            source: "base64",
            data: "AP8=",
            mime: "image/png",
            name: "reference.png",
          },
        ],
      });
      const prompt = promptFor(request);
      const json = prompt
        .split("Task payload (JSON):\n")[1]
        .split("\n\nReturn the deliverable")[0];
      expect(JSON.parse(json)).toEqual({
        objective,
        acceptanceCriteria: ["Handle empty input"],
        allowedPaths: ["src/"],
        attachedImages: [{ index: 1, name: "reference.png" }],
      });
      expect(prompt).not.toContain("AP8=");
    },
  );
  it("does not leak local image paths into the provider prompt", () => {
    const request = taskRequestSchema.parse({
      capability: "image.analyze",
      objective: "Read the label",
      images: [{ source: "path", path: "/private/customer/photo.png" }],
    });
    const prompt = promptFor(request);
    expect(prompt).not.toContain("/private/customer");
    expect(prompt).toContain('"index": 1');
    expect(prompt).toContain("mark unreadable portions rather than guessing");
  });
  it("uses different output expectations for reviews and image edits", () => {
    const base = {
      objective: "test",
      acceptanceCriteria: [],
      allowedPaths: [],
      timeoutSeconds: 30,
    };
    expect(promptFor({ ...base, capability: "code.review" })).toContain(
      "Never invent line numbers or test results",
    );
    expect(promptFor({ ...base, capability: "image.edit" })).toContain(
      "Change only what the objective requests",
    );
  });
});
