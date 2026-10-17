import { localClient } from "./local-client.js";
export async function connectBrowser(force = false) {
  const request = await localClient();
  const response = await request("/v1/status");
  const status = (await response.json()) as {
    provider: { name: string };
    browserAdapter: { state?: string; mode?: string };
  };
  if (status.provider.name !== "chatgpt-playwright")
    throw new Error(
      "Set WRAPPER_ADAPTER=playwright and restart the existing daemon first.",
    );
  const expectedMode =
    process.env.BROWSER_HEADLESS === "true" ? "headless" : "visible";
  if (status.browserAdapter.mode && status.browserAdapter.mode !== expectedMode)
    throw new Error(
      `The worker is running in ${status.browserAdapter.mode} mode. Run chatgpt-wrapper stop, then reconnect with --${expectedMode}.`,
    );
  if (status.browserAdapter.state === "READY" && !force) {
    console.log("ChatGPT is already connected. Ready for MCP tasks.");
    return;
  }
  if (
    !["SIGNING_IN", "VERIFYING"].includes(status.browserAdapter.state ?? "")
  ) {
    console.log(
      "Opening ChatGPT. Sign in once; setup finishes automatically and closes the window.",
    );
    await request("/v1/browser/connect", {});
  } else {
    console.log(
      "Waiting for the sign-in already in progress. Complete it in the open window.",
    );
  }
  let previous = "";
  for (;;) {
    const result = (await (await request("/v1/status")).json()) as {
      browserAdapter: { state: string; message?: string };
    };
    const { state, message } = result.browserAdapter;
    if (state !== previous) {
      console.log(message ?? state);
      previous = state;
    }
    if (state === "READY") {
      console.log(
        "Ready. Use Wrapper from your MCP client. You can close this terminal.",
      );
      break;
    }
    if (!["SIGNING_IN", "VERIFYING"].includes(state)) {
      throw new Error(message ?? "Browser connection failed");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
