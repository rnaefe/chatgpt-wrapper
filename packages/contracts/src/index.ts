import { z } from "zod";
import { Buffer } from "node:buffer";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_TASK_BODY_BYTES = 29 * 1024 * 1024;

export const progressStageSchema = z.enum([
  "queued",
  "opening_browser",
  "preparing_chat",
  "selecting_model",
  "uploading_images",
  "uploading_files",
  "preparing_research",
  "submitting_prompt",
  "waiting_response",
  "receiving_response",
  "downloading_images",
  "validating",
  "saving_result",
  "completed",
]);
export type ProgressStage = z.infer<typeof progressStageSchema>;
export const progressMessages: Record<ProgressStage, string> = {
  queued: "Waiting in queue",
  opening_browser: "Opening browser",
  preparing_chat: "Preparing conversation",
  selecting_model: "Selecting model",
  uploading_images: "Preparing and uploading images",
  uploading_files: "Preparing and uploading files",
  preparing_research: "Enabling web research",
  submitting_prompt: "Submitting prompt",
  waiting_response: "Prompt confirmed; waiting for response",
  receiving_response: "Receiving response",
  downloading_images: "Downloading generated images",
  validating: "Validating result",
  saving_result: "Saving result",
  completed: "Task completed",
};
export interface TaskProgress {
  stage: ProgressStage;
  message: string;
  updatedAt: string;
  revision: number;
}

export const capabilitySchema = z.enum([
  "code.generate",
  "code.review",
  "reason.analyze",
  "research.search",
  "image.generate",
  "image.analyze",
  "image.edit",
]);
export const statusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "VALIDATING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "NEEDS_AUTH",
  "NEEDS_HUMAN",
  "BLOCKED_BY_PROVIDER",
]);
const imageInputSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("path"),
    path: z.string().min(1).max(2000),
  }),
  z.object({
    source: z.literal("base64"),
    data: z
      .string()
      .min(1)
      .max(4 * Math.ceil(MAX_IMAGE_BYTES / 3)),
    mime: z.string().regex(/^image\/[a-z0-9.+-]+$/i),
    name: z.string().min(1).max(200),
  }),
  z.object({
    source: z.literal("url"),
    url: z
      .string()
      .url()
      .refine((value) => value.startsWith("https://"), {
        message: "Image URLs must use HTTPS",
      }),
  }),
]);
export const fileInputSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("path"), path: z.string().min(1).max(2000) }),
  z.object({
    source: z.literal("base64"),
    name: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[^\\/\x00-\x1f\x7f]+$/),
    mime: z.string().min(1).max(150),
    data: z
      .string()
      .min(1)
      .max(4 * Math.ceil(MAX_IMAGE_BYTES / 3)),
  }),
]);
export type FileInput = z.infer<typeof fileInputSchema>;
export interface ResearchSource {
  url: string;
  title: string;
}

export const taskRequestSchema = z
  .strictObject({
    capability: capabilitySchema,
    objective: z.string().trim().min(1).max(100_000),
    model: z
      .string()
      .regex(
        /^[^\x00-\x1f\x7f-\x9f]*$/,
        "Model must not contain control characters",
      )
      .trim()
      .min(1)
      .max(100)
      .optional(),
    conversationId: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase())
      .optional(),
    acceptanceCriteria: z.array(z.string().max(2000)).max(30).default([]),
    allowedPaths: z.array(z.string().max(500)).max(100).default([]),
    images: z.array(imageInputSchema).max(8).default([]),
    files: z.array(fileInputSchema).max(8).default([]),
    idempotencyKey: z.string().min(1).max(200).optional(),
    timeoutSeconds: z.number().int().min(1).max(1800).default(300),
  })
  .superRefine((request, context) => {
    if (request.images.length + request.files.length > 8)
      context.addIssue({
        code: "custom",
        path: ["files"],
        message: "At most 8 attachments are allowed per task",
      });
    let totalImageBytes = 0;
    request.images.forEach((image, index) => {
      if (image.source !== "base64") return;
      const bytes = Buffer.byteLength(image.data, "base64");
      totalImageBytes += bytes;
      if (bytes > MAX_IMAGE_BYTES)
        context.addIssue({
          code: "custom",
          path: ["images", index, "data"],
          message: "Each image must be at most 10 MiB",
        });
    });
    request.files.forEach((file, index) => {
      if (file.source !== "base64") return;
      const bytes = Buffer.byteLength(file.data, "base64");
      totalImageBytes += bytes;
      if (bytes > MAX_IMAGE_BYTES)
        context.addIssue({
          code: "custom",
          path: ["files", index, "data"],
          message: "Each file must be at most 10 MiB",
        });
    });
    if (totalImageBytes > MAX_TOTAL_IMAGE_BYTES)
      context.addIssue({
        code: "custom",
        path: ["images"],
        message: request.files.length
          ? "Combined attachments must be at most 20 MiB"
          : "Combined image inputs must be at most 20 MiB",
      });
    if (
      (request.capability === "image.edit" ||
        request.capability === "image.analyze") &&
      !request.images.length
    )
      context.addIssue({
        code: "custom",
        path: ["images"],
        message: "This capability requires at least one input image",
      });
  });

export const batchRequestSchema = z.strictObject({
  tasks: z.array(taskRequestSchema).min(1).max(20),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export function producesImage(capability: string): boolean {
  return capability === "image.generate" || capability === "image.edit";
}
export type TaskRequest = z.infer<typeof taskRequestSchema>;
export type ImageInput = z.infer<typeof imageInputSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export type TaskStatus = z.infer<typeof statusSchema>;
export interface Artifact {
  id: string;
  mime: string;
  bytes: number;
  createdAt: string;
  source: string;
  kind?: "text" | "image";
}
export interface TaskResult {
  text: string;
  sources?: ResearchSource[];
  conversationId?: string;
  conversationUrl?: string;
  artifacts: Artifact[];
  provenance: { adapter: string; model: string };
  validation: { passed: boolean; checks: string[] };
}
export interface Task {
  id: string;
  status: TaskStatus;
  request: TaskRequest;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress?: TaskProgress;
  result?: TaskResult;
  error?: { code: string; message: string };
}
export interface TaskEvent {
  status: TaskStatus;
  at: string;
  detail?: string;
  progress?: TaskProgress;
}
export const terminalStatuses: TaskStatus[] = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "NEEDS_AUTH",
  "NEEDS_HUMAN",
  "BLOCKED_BY_PROVIDER",
];
