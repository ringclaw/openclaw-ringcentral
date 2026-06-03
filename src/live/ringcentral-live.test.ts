import { describe, expect, it } from "vitest";
import { createBotClient, createOwnerClient } from "../client.js";
import { createRingCentralHistoryTool } from "../history-tool.js";
import { deleteMessage, sendMessage } from "../send.js";
import { extractChatId } from "../targets.js";
import type { RingCentralClient } from "../client.js";
import type { Post } from "../types.js";

const required = readBooleanEnv("RC_E2E_REQUIRED", false);
const enabled = readBooleanEnv("RC_E2E_ENABLED", false);

if (required && !enabled) {
  throw new Error("Set RC_E2E_ENABLED=true to run RingCentral live smoke tests.");
}

const liveDescribe = enabled ? describe : describe.skip;

liveDescribe("RingCentral live smoke", () => {
  it("sends, reads, verifies history, and cleans up a test group message", async () => {
    const env = readLiveEnv();
    const botClient = createBotClient(env.serverUrl, env.botToken);
    const ownerClient = createOwnerClient(
      env.serverUrl,
      env.ownerClientId,
      env.ownerClientSecret,
      env.ownerJwtToken,
    );
    const uniqueText = buildUniqueText();
    const createdPostIds: string[] = [];

    try {
      const botExtension = await botClient.getExtensionInfo();
      expect(botExtension.id).toBeTruthy();

      const ownerExtension = await ownerClient.getExtensionInfo();
      expect(ownerExtension.id).toBeTruthy();

      const chat = await getChatMetadata({ ownerClient, botClient, chatId: env.chatId });
      expect(chat.id).toBe(env.chatId);
      await assertOwnerCanReadHistory(ownerClient, env.chatId, env.recordCount);

      const sent = await sendMessage({
        client: botClient,
        chatId: env.chatId,
        text: uniqueText,
        convertMarkdown: false,
        replyToMode: "off",
      });
      expect(sent?.postId).toBeTruthy();
      if (sent?.postId) {
        createdPostIds.push(sent.postId);
      }

      const found = await waitForPost(ownerClient, env.chatId, uniqueText, env.recordCount);
      expect(found?.id).toBe(sent?.postId);
      expect(found?.text).toContain(uniqueText);

      const historyText = await readHistoryToolText({
        serverUrl: env.serverUrl,
        botToken: env.botToken,
        ownerClientId: env.ownerClientId,
        ownerClientSecret: env.ownerClientSecret,
        ownerJwtToken: env.ownerJwtToken,
        chatId: env.chatId,
        recordCount: env.recordCount,
      });
      expect(historyText).toContain(uniqueText);
    } finally {
      if (env.cleanup) {
        for (const postId of createdPostIds.reverse()) {
          await deleteMessage(botClient, env.chatId, postId);
          console.log(`[ringcentral-live] cleanup requested for post ${postId}`);
        }
      } else {
        console.log(`[ringcentral-live] cleanup disabled; post ids: ${createdPostIds.join(", ")}`);
      }
    }
  });
});

interface LiveEnv {
  serverUrl: string;
  botToken: string;
  ownerClientId: string;
  ownerClientSecret: string;
  ownerJwtToken: string;
  chatId: string;
  recordCount: number;
  cleanup: boolean;
}

function readLiveEnv(): LiveEnv {
  const missing: string[] = [];
  const readRequired = (name: string) => {
    const value = process.env[name]?.trim();
    if (!value) {
      missing.push(name);
    }
    return value ?? "";
  };
  const env = {
    serverUrl: process.env.RC_SERVER_URL?.trim() || "https://platform.ringcentral.com",
    botToken: readRequired("RC_BOT_TOKEN"),
    ownerClientId: readRequired("RC_USER_CLIENT_ID"),
    ownerClientSecret: readRequired("RC_USER_CLIENT_SECRET"),
    ownerJwtToken: readRequired("RC_USER_JWT_TOKEN"),
    chatId: normalizeChatId(readRequired("RC_E2E_CHAT_ID")),
    recordCount: readRecordCount(),
    cleanup: readBooleanEnv("RC_E2E_CLEANUP", true),
  };
  if (missing.length > 0) {
    throw new Error(`Missing RingCentral live smoke variables: ${missing.join(", ")}`);
  }
  return env;
}

function normalizeChatId(raw: string): string {
  return extractChatId(raw) ?? raw;
}

function readRecordCount(): number {
  const parsed = Number(process.env.RC_E2E_RECORD_COUNT ?? "50");
  if (!Number.isFinite(parsed)) {
    return 50;
  }
  return Math.min(Math.max(Math.trunc(parsed), 1), 1000);
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(raw);
}

function buildUniqueText(): string {
  const runId = process.env.GITHUB_RUN_ID ?? "local";
  const attempt = process.env.GITHUB_RUN_ATTEMPT ?? "1";
  return `[openclaw-ringcentral-e2e:${runId}:${attempt}:${Date.now()}]`;
}

async function waitForPost(
  client: ReturnType<typeof createOwnerClient>,
  chatId: string,
  expectedText: string,
  recordCount: number,
): Promise<Post | undefined> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const post = await findRecentPost(client, chatId, expectedText, recordCount);
    if (post) {
      return post;
    }
    await delay(1500);
  }
  return undefined;
}

async function findRecentPost(
  client: ReturnType<typeof createOwnerClient>,
  chatId: string,
  expectedText: string,
  recordCount: number,
): Promise<Post | undefined> {
  const posts = await readRecentPosts(client, chatId, recordCount);
  return posts.find((post) => post.text?.includes(expectedText));
}

async function readRecentPosts(
  client: ReturnType<typeof createOwnerClient>,
  chatId: string,
  recordCount: number,
): Promise<Post[]> {
  try {
    return (await client.listPosts(chatId, recordCount)).records ?? [];
  } catch {
    return (await client.listLegacyGroupPosts(chatId, recordCount)).records ?? [];
  }
}

async function getChatMetadata(params: {
  ownerClient: RingCentralClient;
  botClient: RingCentralClient;
  chatId: string;
}) {
  try {
    return await params.ownerClient.getChat(params.chatId);
  } catch (ownerErr) {
    try {
      const chat = await params.botClient.getChat(params.chatId);
      console.log(
        "[ringcentral-live] owner chat metadata lookup failed; bot metadata lookup succeeded",
      );
      return chat;
    } catch {
      throw ownerErr;
    }
  }
}

async function assertOwnerCanReadHistory(
  ownerClient: RingCentralClient,
  chatId: string,
  recordCount: number,
): Promise<void> {
  try {
    await readRecentPosts(ownerClient, chatId, Math.min(recordCount, 1));
  } catch (err) {
    throw new Error(
      [
        `Owner credentials cannot read RingCentral chat ${chatId}.`,
        "Ensure RC_USER_JWT_TOKEN belongs to a user who is a member of RC_E2E_CHAT_ID.",
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
      ].join(" "),
    );
  }
}

async function readHistoryToolText(params: {
  serverUrl: string;
  botToken: string;
  ownerClientId: string;
  ownerClientSecret: string;
  ownerJwtToken: string;
  chatId: string;
  recordCount: number;
}): Promise<string> {
  const tool = createRingCentralHistoryTool({
    channels: {
      ringcentral: {
        botToken: params.botToken,
        server: params.serverUrl,
        ownerCredentials: {
          clientId: params.ownerClientId,
          clientSecret: params.ownerClientSecret,
          jwt: params.ownerJwtToken,
        },
        homeChannel: params.chatId,
      },
    },
  });
  const result = await tool.execute("ringcentral-live-smoke", {
    target: `ringcentral:chat:${params.chatId}`,
    target_type: "chat",
    record_count: params.recordCount,
  });
  return result.content
    .map((item) => (item.type === "text" ? item.text : ""))
    .filter(Boolean)
    .join("\n");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
