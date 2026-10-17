import { describe, expect, it } from "vitest";
import { taskRequestSchema } from "./index.js";

describe.each(["image.edit", "image.analyze"])("%s", (capability) => {
  it("requires an input image", () => {
    const result = taskRequestSchema.safeParse({
      capability,
      objective: "Inspect or edit this image",
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0].path).toEqual(["images"]);
  });
  it("accepts a reference without changing existing defaults", () => {
    const request = taskRequestSchema.parse({
      capability,
      objective: "Use the attached image",
      images: [
        {
          source: "base64",
          data: "AP8=",
          mime: "image/png",
          name: "reference.png",
        },
      ],
    });
    expect(request.timeoutSeconds).toBe(300);
    expect(request.images).toHaveLength(1);
  });
});
