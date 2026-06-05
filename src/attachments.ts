import { buildAgentMediaPayload, saveMediaBuffer } from "openclaw/plugin-sdk/media-runtime";
import { mediaKindFromMime } from "openclaw/plugin-sdk/media-mime";
import { isAuthzOrNotFoundError, type RingCentralClient } from "./client.js";
import type { Attachment, ResolvedAccount } from "./types.js";

type LogFn = (message: string) => void;

export interface ResolveInboundAttachmentsOptions {
  attachments: Attachment[] | undefined;
  primaryClient: RingCentralClient;
  fallbackClient?: RingCentralClient;
  account: ResolvedAccount;
  log?: LogFn;
}

interface NormalizedAttachment {
  uri: string;
  fileName: string;
  contentType?: string;
}

export async function resolveInboundAttachmentsForAgent(
  opts: ResolveInboundAttachmentsOptions,
): Promise<Record<string, unknown>> {
  const cfg = opts.account.attachments;
  if (!cfg.enabled || cfg.maxCount <= 0 || !opts.attachments?.length) {
    return {};
  }

  const mediaList: Array<{ path: string; contentType?: string | null }> = [];
  for (const attachment of opts.attachments.slice(0, cfg.maxCount)) {
    const normalized = normalizeAttachment(attachment);
    if (!normalized) {
      opts.log?.("[ringcentral] inbound attachment skipped: missing uri");
      continue;
    }
    const downloaded = await downloadWithFallback({
      attachment: normalized,
      primaryClient: opts.primaryClient,
      fallbackClient: opts.fallbackClient,
      maxBytes: cfg.maxBytes,
      log: opts.log,
    });
    if (!downloaded) {
      continue;
    }
    try {
      const saved = await saveMediaBuffer(
        downloaded.buffer,
        downloaded.contentType,
        "inbound",
        cfg.maxBytes,
        downloaded.fileName,
      );
      mediaList.push({
        path: saved.path,
        contentType: saved.contentType ?? downloaded.contentType,
      });
      opts.log?.(
        `[ringcentral] inbound attachment saved: kind=${mediaKindFromMime(saved.contentType ?? downloaded.contentType) ?? "document"} size=${downloaded.size}`,
      );
    } catch {
      opts.log?.("[ringcentral] inbound attachment skipped: save failed");
    }
  }

  return mediaList.length > 0 ? buildAgentMediaPayload(mediaList) : {};
}

function normalizeAttachment(attachment: Attachment): NormalizedAttachment | undefined {
  const uri = (attachment.uri ?? attachment.contentUri ?? "").trim();
  if (!uri) {
    return undefined;
  }
  return {
    uri,
    fileName: normalizeFileName(attachment.fileName ?? attachment.name),
    contentType: attachment.contentType?.trim() || undefined,
  };
}

function normalizeFileName(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "attachment";
  }
  return trimmed.replace(/[\0\r\n]+/g, " ").trim() || "attachment";
}

async function downloadWithFallback(opts: {
  attachment: NormalizedAttachment;
  primaryClient: RingCentralClient;
  fallbackClient?: RingCentralClient;
  maxBytes: number;
  log?: LogFn;
}) {
  try {
    return await opts.primaryClient.downloadAttachment({
      uri: opts.attachment.uri,
      fileName: opts.attachment.fileName,
      contentType: opts.attachment.contentType,
      maxBytes: opts.maxBytes,
    });
  } catch (err) {
    if (!opts.fallbackClient || !isAuthzOrNotFoundError(err)) {
      opts.log?.("[ringcentral] inbound attachment skipped: download failed");
      return undefined;
    }
  }

  try {
    return await opts.fallbackClient.downloadAttachment({
      uri: opts.attachment.uri,
      fileName: opts.attachment.fileName,
      contentType: opts.attachment.contentType,
      maxBytes: opts.maxBytes,
    });
  } catch {
    opts.log?.("[ringcentral] inbound attachment skipped: fallback download failed");
    return undefined;
  }
}
