import { z } from "zod";

export const capabilitySchema = z.enum([
  "code.generate",
  "code.review",
  "reason.analyze",
  "image.generate",
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
    data: z.string().min(1).max(14_000_000),
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
export const taskRequestSchema = z.strictObject({
  capability: capabilitySchema,
  objective: z.string().trim().min(1).max(100_000),
  acceptanceCriteria: z.array(z.string().max(2000)).max(30).default([]),
  allowedPaths: z.array(z.string().max(500)).max(100).default([]),
  images: z.array(imageInputSchema).max(8).default([]),
  idempotencyKey: z.string().min(1).max(200).optional(),
  timeoutSeconds: z.number().int().min(1).max(1800).default(300),
});
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
  result?: TaskResult;
  error?: { code: string; message: string };
}
export interface TaskEvent {
  status: TaskStatus;
  at: string;
  detail?: string;
}
export const terminalStatuses: TaskStatus[] = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "NEEDS_AUTH",
  "NEEDS_HUMAN",
  "BLOCKED_BY_PROVIDER",
];
