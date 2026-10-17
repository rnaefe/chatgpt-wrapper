import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const inlineLimit = 10 * 1024 * 1024;
const extensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

export async function deliverImage(
  id: string,
  data: Buffer,
  mime: string,
  directory: string,
) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid artifact ID");
  const content: Array<
    | { type: "image"; data: string; mimeType: string }
    | { type: "text"; text: string }
  > = [];
  if (data.length <= inlineLimit)
    content.push({
      type: "image",
      data: data.toString("base64"),
      mimeType: mime,
    });

  const extension = extensions[mime];
  if (!extension) {
    content.push({
      type: "text",
      text: JSON.stringify({
        id,
        mime,
        error: "UNSUPPORTED_IMAGE_EXPORT",
        message: "No local export is available for this image format.",
      }),
    });
    return { content };
  }
  try {
    const exports = join(directory, "image-exports");
    await mkdir(exports, { recursive: true, mode: 0o700 });
    const localPath = join(exports, `${id}.${extension}`);
    await writeFile(localPath, data, { mode: 0o600 });
    // Angle brackets preserve spaces in paths; encode Markdown delimiters.
    const target = localPath
      .replaceAll("%", "%25")
      .replaceAll("<", "%3C")
      .replaceAll(">", "%3E")
      .replaceAll("\n", "%0A")
      .replaceAll("\r", "%0D");
    content.push({
      type: "text",
      text: JSON.stringify({
        id,
        mime,
        bytes: data.length,
        localPath,
        displayMarkdown: `![Generated image](<${target}>)`,
        downloadMarkdown: `[Download image](<${target}>)`,
        inlineImageIncluded: data.length <= inlineLimit,
        message:
          "Include displayMarkdown and downloadMarkdown in the final chat reply so the user can see and save the image. The local file is on the MCP server host; remote clients must transfer it first. Exports remain until manually removed.",
      }),
    });
  } catch {
    content.push({
      type: "text",
      text: JSON.stringify({
        id,
        mime,
        error: "IMAGE_EXPORT_FAILED",
        message:
          "Could not save the local image file. Use the inline image if available, or retrieve the artifact through authenticated local HTTP.",
      }),
    });
  }
  return { content };
}
