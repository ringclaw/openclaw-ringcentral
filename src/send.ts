// Outbound message delivery — send text and media to RingCentral.

import type { RingCentralClient } from "./client.js";
import { markdownToMiniMarkdown } from "./markdown.js";

export interface SendOptions {
  client: RingCentralClient;
  chatId: string;
  text?: string;
  mediaUrl?: string;
  replyToId?: string;
  convertMarkdown?: boolean;
}

export async function sendMessage(opts: SendOptions): Promise<{ postId: string } | null> {
  const { client, chatId, text, mediaUrl, convertMarkdown = true } = opts;

  if (mediaUrl) {
    try {
      const resp = await fetch(mediaUrl);
      if (resp.ok) {
        const buf = Buffer.from(await resp.arrayBuffer());
        const contentType = resp.headers.get("content-type") ?? "application/octet-stream";
        const ext = contentType.includes("png") ? "png" : contentType.includes("gif") ? "gif" : "jpg";
        const post = await client.uploadFile(chatId, `image.${ext}`, buf, contentType);
        return { postId: post.id };
      }
    } catch {
      // Fall through to send as text link
    }
  }

  if (text) {
    const finalText = convertMarkdown ? markdownToMiniMarkdown(text) : text;
    const post = await client.sendPost(chatId, finalText);
    return { postId: post.id };
  }

  return null;
}

export async function sendTypingIndicator(
  client: RingCentralClient,
  chatId: string,
  text = "🦞 is thinking...",
): Promise<string | undefined> {
  try {
    const post = await client.sendPost(chatId, text);
    return post.id;
  } catch {
    return undefined;
  }
}

export async function updateMessage(
  client: RingCentralClient,
  chatId: string,
  postId: string,
  text: string,
  convertMarkdown = true,
): Promise<void> {
  const finalText = convertMarkdown ? markdownToMiniMarkdown(text) : text;
  await client.updatePost(chatId, postId, finalText);
}

export async function deleteMessage(
  client: RingCentralClient,
  chatId: string,
  postId: string,
): Promise<void> {
  try {
    await client.deletePost(chatId, postId);
  } catch {
    // ignore
  }
}
