import { afterEach, expect, it, vi } from "vitest";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../src/local-client.js", () => ({ localClient: async () => request }));
import { connectBrowser } from "../src/browser-login.js";
const response = (state: string) => ({
  json: async () => ({
    provider: { name: "chatgpt-playwright" },
    browserAdapter: { state, mode: "visible" },
  }),
});
afterEach(() => {
  vi.restoreAllMocks();
  request.mockReset();
  vi.unstubAllEnvs();
});
it("does not reopen sign-in when the worker is ready", async () => {
  vi.stubEnv("BROWSER_HEADLESS", "false");
  vi.spyOn(console, "log").mockImplementation(() => {});
  request.mockResolvedValue(response("READY"));
  await connectBrowser();
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith("/v1/status");
});
it("joins existing sign-in instead of opening another browser", async () => {
  vi.stubEnv("BROWSER_HEADLESS", "false");
  vi.spyOn(console, "log").mockImplementation(() => {});
  request
    .mockResolvedValueOnce(response("SIGNING_IN"))
    .mockResolvedValueOnce(response("READY"));
  await connectBrowser();
  expect(request.mock.calls.every(([path]) => path === "/v1/status")).toBe(
    true,
  );
});
it("can explicitly reopen sign-in after a stale ready status", async () => {
  vi.stubEnv("BROWSER_HEADLESS", "false");
  vi.spyOn(console, "log").mockImplementation(() => {});
  request.mockResolvedValue(response("READY"));
  await connectBrowser(true);
  expect(request).toHaveBeenCalledWith("/v1/browser/connect", {});
});
