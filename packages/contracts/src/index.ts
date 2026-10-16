import { z } from "zod";

export const capabilitySchema = z.enum([
  "code.generate",
  "code.review",
  "reason.analyze",
  "image.generate",
  "image.edit",
]);

export const taskRequestSchema = z.object({
  capability: capabilitySchema,
  objective: z.string().min(1),
  acceptanceCriteria: z.array(z.string()).default([]),
  allowedPaths: z.array(z.string()).default([]),
});

export type TaskRequest = z.infer<typeof taskRequestSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
