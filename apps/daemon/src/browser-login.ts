import { localClient } from "./local-client.js";
const request = await localClient();
const response = await request("/v1/status");
const status = (await response.json()) as {
  provider: { name: string };
  browserAdapter: { state?: string };
};
if (status.provider.name !== "chatgpt-playwright")
  throw new Error(
    "Set WRAPPER_ADAPTER=playwright and restart the existing daemon first.",
  );
console.log(
  "Opening ChatGPT. Complete sign-in or browser verification in the window. Keep it open for MCP tasks.",
);
await request("/v1/browser/connect", {});
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
    process.exitCode = 1;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
