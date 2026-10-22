import { describe, expect, it } from "vitest";
import {
  taskRequestSchema,
  MAX_IMAGE_BYTES,
  MAX_TASK_BODY_BYTES,
} from "./index.js";

it("accepts selected files and research while preserving legacy defaults", () => {
  const request = taskRequestSchema.parse({
    capability: "research.search",
    objective: "Research this source",
    files: [
      { source: "base64", name: "source.ts", mime: "text/plain", data: "YQ==" },
    ],
  });
  expect(request.files).toHaveLength(1);
  expect(
    taskRequestSchema.parse({ capability: "reason.analyze", objective: "test" })
      .files,
  ).toEqual([]);
});

it("bounds attachments across image and document inputs together", () => {
  const image = {
    source: "base64",
    data: "YQ==",
    name: "ref.png",
    mime: "image/png",
  };
  const file = {
    source: "base64",
    data: "YQ==",
    name: "ref.txt",
    mime: "text/plain",
  };
  expect(
    taskRequestSchema.safeParse({
      capability: "reason.analyze",
      objective: "test",
      images: Array(4).fill(image),
      files: Array(5).fill(file),
    }).success,
  ).toBe(false);
  const data = Buffer.alloc(7 * 1024 * 1024).toString("base64");
  expect(
    taskRequestSchema.safeParse({
      capability: "reason.analyze",
      objective: "test",
      images: [{ ...image, data }],
      files: [
        { ...file, data },
        { ...file, data },
      ],
    }).success,
  ).toBe(false);
});

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

it("accepts two full-size base64 images within the HTTP body budget", () => {
  const image = {
    source: "base64",
    data: Buffer.alloc(MAX_IMAGE_BYTES).toString("base64"),
    mime: "image/png",
    name: "reference.png",
  };
  const request = taskRequestSchema.parse({
    capability: "image.analyze",
    objective: "Compare the images",
    images: [image, image],
  });
  expect(Buffer.byteLength(JSON.stringify(request))).toBeLessThan(
    MAX_TASK_BODY_BYTES,
  );
});

it("rejects combined base64 inputs above 20 MiB before submission", () => {
  const image = {
    source: "base64",
    data: Buffer.alloc(7 * 1024 * 1024).toString("base64"),
    mime: "image/png",
    name: "reference.png",
  };
  const result = taskRequestSchema.safeParse({
    capability: "image.analyze",
    objective: "Compare the images",
    images: [image, image, image],
  });
  expect(result.success).toBe(false);
  if (!result.success)
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["images"],
        message: "Combined image inputs must be at most 20 MiB",
      }),
    );
});

describe("model selection and conversation continuity", () => {
  const base = { capability: "reason.analyze", objective: "Analyze this" };
  const conversationId = "550e8400-e29b-41d4-a716-446655440000";

  it("preserves existing defaults without adding selection fields", () => {
    expect(taskRequestSchema.parse(base)).toEqual({
      ...base,
      acceptanceCriteria: [],
      allowedPaths: [],
      images: [],
      files: [],
      timeoutSeconds: 300,
    });
  });

  it("trims a visible model label and canonicalizes the conversation UUID", () => {
    expect(
      taskRequestSchema.parse({
        ...base,
        model: "  Exact visible label  ",
        conversationId: conversationId.toUpperCase(),
      }),
    ).toMatchObject({
      model: "Exact visible label",
      conversationId,
    });
  });

  it.each([
    "",
    "  ",
    "a".repeat(101),
    "Label\n",
    "Label\tOther",
    "Label\u0000",
    "Label\u007f",
    "Label\u0085",
  ])("rejects invalid model %j", (model) => {
    expect(taskRequestSchema.safeParse({ ...base, model }).success).toBe(false);
  });

  it.each([
    "",
    "not-a-uuid",
    "https://chatgpt.com/c/550e8400-e29b-41d4-a716-446655440000",
    "/c/550e8400-e29b-41d4-a716-446655440000",
    " 550e8400-e29b-41d4-a716-446655440000 ",
  ])("rejects invalid conversation ID %j", (conversationId) => {
    expect(
      taskRequestSchema.safeParse({ ...base, conversationId }).success,
    ).toBe(false);
  });

  it("retains selection fields alongside an idempotency key", () => {
    expect(
      taskRequestSchema.parse({
        ...base,
        model: "Visible label",
        conversationId,
        idempotencyKey: "follow-up-1",
      }),
    ).toMatchObject({
      model: "Visible label",
      conversationId,
      idempotencyKey: "follow-up-1",
    });
  });
});
