import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import {
  conversationIdFromUrl,
  openConversation,
  readConversation,
} from "../src/browser-conversations.js";
const id = "01234567-89ab-cdef-0123-456789abcdef";
const target = `https://chatgpt.com/c/${id}`;
afterEach(() => vi.useRealTimers());
it("accepts only a canonical conversation path and normalizes UUID casing", () => {
  expect(conversationIdFromUrl(target)).toBe(id);
  expect(
    conversationIdFromUrl(`https://chatgpt.com/c/${id.toUpperCase()}`),
  ).toBe(id);
  for (const url of [
    target + "\n",
    target + "/",
    target + "?x=1",
    target + "#x",
    target + "?",
    target + "#",
    target.replace("https:", "http:"),
    target.replace("chatgpt.com", "chatgpt.com:443"),
    target.replace("chatgpt.com", "a@chatgpt.com"),
    target.replace("chatgpt.com", "chatgpt.com.evil.test"),
    target.replace("/c/", "/foo/../c/"),
    target.replace(id, "bad"),
    target.replace("/c/", "/g/c/"),
  ])
    expect(conversationIdFromUrl(url)).toBeUndefined();
});
it("validates IDs and cancellation before touching navigation", async () => {
  const goto = vi.fn();
  const page = { goto } as unknown as Page;
  await expect(
    openConversation(page, "bad", new AbortController().signal),
  ).rejects.toMatchObject({ code: "INVALID_CONVERSATION_ID" });
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await expect(openConversation(page, id, controller.signal)).rejects.toThrow(
    "cancelled",
  );
  expect(goto).not.toHaveBeenCalled();
});
it("fails closed on redirection and on missing history", async () => {
  const page = {
    goto: vi.fn(),
    url: () => target,
    evaluate: async () => ({ login: false, challenge: false, history: false }),
  } as unknown as Page;
  vi.useFakeTimers();
  const missing = expect(
    openConversation(page, id, new AbortController().signal),
  ).rejects.toMatchObject({
    code: "CONVERSATION_UNAVAILABLE",
    status: "NEEDS_HUMAN",
  });
  await vi.advanceTimersByTimeAsync(10_500);
  await missing;
  page.url = () => "https://chatgpt.com/";
  await expect(
    openConversation(page, id, new AbortController().signal),
  ).rejects.toMatchObject({ code: "CONVERSATION_UNAVAILABLE" });
});
it("cancels while polling and while navigation is pending", async () => {
  const controller = new AbortController();
  const page = {
    goto: async () => {},
    url: () => target,
    evaluate: async () => ({ history: false }),
  } as unknown as Page;
  const result = expect(
    openConversation(page, id, controller.signal),
  ).rejects.toThrow("stop");
  controller.abort(new Error("stop"));
  await result;
  const navigationController = new AbortController();
  page.goto = () => new Promise(() => {});
  const navigating = expect(
    openConversation(page, id, navigationController.signal),
  ).rejects.toThrow("stop navigation");
  navigationController.abort(new Error("stop navigation"));
  await navigating;
});
it("reads conversation metadata and rejects any change to an expected ID", async () => {
  const page = { url: () => target } as unknown as Page;
  await expect(readConversation(page, id)).resolves.toEqual({
    conversationId: id,
    conversationUrl: target,
  });
  page.url = () => "https://chatgpt.com/";
  await expect(readConversation(page, id)).rejects.toMatchObject({
    code: "CONVERSATION_CHANGED",
    status: "NEEDS_HUMAN",
  });
  await expect(readConversation(page)).resolves.toBeUndefined();
});

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});
it("loads visible history in Chromium without contacting the provider", async () => {
  const page = await browser.newPage();
  await page.route("**/*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div data-message-author-role="user">Earlier prompt</div>',
    }),
  );
  await expect(
    openConversation(page, id, new AbortController().signal),
  ).resolves.toBeUndefined();
  await page.close();
});
it("recognizes alternate turn attributes and authentication in Chromium", async () => {
  const page = await browser.newPage();
  let body =
    '<article data-chatgpt-search-unit-key="turn:assistant">Earlier answer</article>';
  await page.route("**/*", (route) =>
    route.fulfill({ contentType: "text/html", body }),
  );
  await expect(
    openConversation(page, id, new AbortController().signal),
  ).resolves.toBeUndefined();
  body = '<button data-testid="login-button">Log in</button>';
  await expect(
    openConversation(page, id, new AbortController().signal),
  ).rejects.toMatchObject({ code: "LOGIN_REQUIRED", status: "NEEDS_AUTH" });
  body = "<title>Verify you are human</title>";
  await expect(
    openConversation(page, id, new AbortController().signal),
  ).rejects.toMatchObject({
    code: "CONVERSATION_UNAVAILABLE",
    status: "NEEDS_HUMAN",
  });
  await page.close();
});
