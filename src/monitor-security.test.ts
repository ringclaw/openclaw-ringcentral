import { describe, expect, it } from "vitest";
import { summarizeChatInfo, summarizeEvent, sanitizeAttachmentFilename } from "./monitor.js";

describe("sanitizeAttachmentFilename", () => {
  it("allows safe characters", () => {
    expect(sanitizeAttachmentFilename("file-name_123.jpg")).toBe("file-name_123.jpg");
    expect(sanitizeAttachmentFilename("DOCUMENT.PDF")).toBe("DOCUMENT.PDF");
  });

  it("replaces unsafe characters with underscores", () => {
    expect(sanitizeAttachmentFilename("file/name.txt")).toBe("file_name.txt");
    expect(sanitizeAttachmentFilename("file\\name.txt")).toBe("file_name.txt");
    expect(sanitizeAttachmentFilename("file*name.txt")).toBe("file_name.txt");
    expect(sanitizeAttachmentFilename("file?name.txt")).toBe("file_name.txt");
    expect(sanitizeAttachmentFilename("file\"name.txt")).toBe("file_name.txt");
    expect(sanitizeAttachmentFilename("file<name>.txt")).toBe("file_name_.txt");
    expect(sanitizeAttachmentFilename("file|name.txt")).toBe("file_name.txt");
    expect(sanitizeAttachmentFilename("file:name.txt")).toBe("file_name.txt");
  });

  it("neutralizes path traversal sequences", () => {
    expect(sanitizeAttachmentFilename("../../../etc/passwd")).toBe("______etc_passwd");
    expect(sanitizeAttachmentFilename("..\\..\\Windows\\System32")).toBe("____Windows_System32");
    expect(sanitizeAttachmentFilename("file..name.txt")).toBe("file_name.txt");
  });

  it("provides fallback for empty or completely hidden names", () => {
    expect(sanitizeAttachmentFilename("")).toBe("attachment");
    expect(sanitizeAttachmentFilename(".")).toBe("attachment");
    expect(sanitizeAttachmentFilename("..")).toBe("attachment");
    expect(sanitizeAttachmentFilename("_")).toBe("attachment");
  });
});

describe("summarizeChatInfo", () => {
  it("extracts only safe fields from chat object", () => {
    const chat = {
      id: "chat-123",
      type: "Group",
      name: "Secret Team Name",
      description: "Sensitive description",
      members: ["user-1", "user-2", "user-3"],
      status: "Active",
    };
    const result = JSON.parse(summarizeChatInfo(chat));
    expect(result).toEqual({
      id: "chat-123",
      type: "Group",
      memberCount: 3,
      status: "Active",
    });
    expect(result.name).toBeUndefined();
    expect(result.description).toBeUndefined();
  });

  it("handles null input", () => {
    expect(summarizeChatInfo(null)).toBe("null");
  });

  it("handles missing fields gracefully", () => {
    const result = JSON.parse(summarizeChatInfo({ id: "x" }));
    expect(result).toEqual({ id: "x", type: null, memberCount: null, status: null });
  });
});

describe("summarizeEvent", () => {
  it("extracts only safe fields from WebSocket event", () => {
    const event = {
      uuid: "uuid-123",
      event: "/restapi/v1.0/glip/posts",
      subscriptionId: "sub-456",
      timestamp: "2026-02-24T00:00:00Z",
      ownerId: "owner-789",
      body: {
        id: "post-1",
        groupId: "group-1",
        type: "TextMessage",
        text: "This is a secret message",
        creatorId: "user-1",
        eventType: "PostAdded",
        mentions: [{ id: "m1", name: "John Doe" }],
      },
    };
    const result = JSON.parse(summarizeEvent(event));
    expect(result).toEqual({
      event: "/restapi/v1.0/glip/posts",
      subscriptionId: "sub-456",
      shape: {
        hasBody: true,
        bodyKeys: "creatorId,eventType,groupId,id,mentions,text,type",
      },
      body: {
        id: "post-1",
        groupId: "group-1",
        type: "TextMessage",
        eventType: "PostAdded",
        creatorId: "user-1",
        hasText: true,
        attachmentCount: null,
        mentionCount: 1,
      },
    });
    expect(result.body.text).toBeUndefined();
    expect(result.body.mentions).toBeUndefined();
    expect(result.uuid).toBeUndefined();
    expect(result.ownerId).toBeUndefined();
  });

  it("handles null input", () => {
    expect(summarizeEvent(null)).toBe("null");
  });

  it("handles event without body", () => {
    const result = JSON.parse(summarizeEvent({ event: "/test" }));
    expect(result).toEqual({
      event: "/test",
      subscriptionId: null,
      shape: { hasBody: false, bodyKeys: null },
      body: null,
    });
  });
});
