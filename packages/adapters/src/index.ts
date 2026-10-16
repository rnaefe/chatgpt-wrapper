import type { Capability, TaskRequest } from "@chatgpt-wrapper/contracts";

export type FailureStatus =
  "FAILED" | "NEEDS_AUTH" | "NEEDS_HUMAN" | "BLOCKED_BY_PROVIDER";

export class ProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: FailureStatus = "FAILED",
  ) {
    super(message);
  }
}
export interface AdapterOutput {
  text: string;
  model: string;
  adapter: string;
  images?: Array<{ data: Buffer; mime: string; source: string }>;
}
export interface Adapter {
  info(): {
    name: string;
    configured: boolean;
    model?: string;
    capabilities: Capability[];
  };
  canStart?(): boolean;
  close?(): Promise<void>;
  execute(request: TaskRequest, signal: AbortSignal): Promise<AdapterOutput>;
}
