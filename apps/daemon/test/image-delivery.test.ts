import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliverImage } from "../src/image-delivery.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "wrapper image "));
  directories.push(path);
  return path;
}
const id = "a".repeat(64);

it("exports oversized images intact without a base64 payload", async () => {
  const bytes = Buffer.alloc(10 * 1024 * 1024 + 1, 255);
  const result = await deliverImage(id, bytes, "image/png", await directory());
  expect(result.content).toHaveLength(1);
  const delivery = JSON.parse((result.content[0] as { text: string }).text);
  expect(delivery.inlineImageIncluded).toBe(false);
  expect((await readFile(delivery.localPath)).equals(bytes)).toBe(true);
  expect(delivery.displayMarkdown).toBe(
    `![Generated image](<${delivery.localPath}>)`,
  );
  if (process.platform !== "win32")
    expect((await stat(delivery.localPath)).mode & 0o777).toBe(0o600);
});

it("keeps inline delivery when local export fails", async () => {
  const path = join(await directory(), "file");
  await writeFile(path, "not a directory");
  const result = await deliverImage(
    id,
    Buffer.from([0, 255]),
    "image/png",
    path,
  );
  expect(result.content[0]).toMatchObject({ type: "image", data: "AP8=" });
  expect(JSON.parse((result.content[1] as { text: string }).text).error).toBe(
    "IMAGE_EXPORT_FAILED",
  );
});

it("does not use unknown MIME types or invalid IDs as export paths", async () => {
  const result = await deliverImage(
    id,
    Buffer.from("test"),
    "image/../../bad",
    await directory(),
  );
  expect(JSON.parse((result.content[1] as { text: string }).text).error).toBe(
    "UNSUPPORTED_IMAGE_EXPORT",
  );
  await expect(
    deliverImage("../bad", Buffer.from("test"), "image/png", await directory()),
  ).rejects.toThrow("Invalid artifact ID");
});
