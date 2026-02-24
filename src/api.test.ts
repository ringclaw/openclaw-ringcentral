import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ResolvedRingCentralAccount } from "./accounts.js";
import {
  extractRcApiError,
  formatRcApiError,
} from "./api.js";

// Mock the auth module
vi.mock("./auth.js", () => ({
  getRingCentralPlatform: vi.fn(),
}));

const mockAccount: ResolvedRingCentralAccount = {
  accountId: "test",
  enabled: true,
  credentialSource: "config",
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  jwt: "test-jwt",
  server: "https://platform.ringcentral.com",
  config: {},
};

describe("extractRcApiError", () => {
  it("handles null/undefined error", () => {
    const info = extractRcApiError(null);
    expect(info.errorMessage).toBe("null");
  });

  it("handles string error", () => {
    const info = extractRcApiError("Something went wrong");
    expect(info.errorMessage).toBe("Something went wrong");
  });

  it("extracts error from standard Error object", () => {
    const error = new Error("Test error message");
    const info = extractRcApiError(error);
    expect(info.errorMessage).toBe("Test error message");
  });

  it("extracts error from SDK response object", () => {
    const error = {
      response: {
        status: 404,
        headers: {
          get: (name: string) => (name === "x-request-id" ? "req-123" : null),
        },
      },
      message: '{"errorCode":"CMN-102","message":"Resource not found"}',
    };
    const info = extractRcApiError(error, "account-1");
    expect(info.httpStatus).toBe(404);
    expect(info.requestId).toBe("req-123");
    expect(info.errorCode).toBe("CMN-102");
    expect(info.errorMessage).toBe("Resource not found");
    expect(info.accountId).toBe("account-1");
  });

  it("extracts error from body property", () => {
    const error = {
      body: {
        errorCode: "CMN-401",
        message: "Unauthorized",
        errors: [{ errorCode: "SUB-001", message: "Invalid token" }],
      },
    };
    const info = extractRcApiError(error);
    expect(info.errorCode).toBe("CMN-401");
    expect(info.errorMessage).toBe("Unauthorized");
    expect(info.errors).toHaveLength(1);
    expect(info.errors?.[0].errorCode).toBe("SUB-001");
  });
});

describe("formatRcApiError", () => {
  it("formats complete error info", () => {
    const info = {
      httpStatus: 403,
      errorCode: "CMN-401",
      requestId: "req-456",
      accountId: "work",
      errorMessage: "Permission denied",
      errors: [{ errorCode: "ERR-1", message: "Missing scope", parameterName: "scope" }],
    };
    const formatted = formatRcApiError(info);
    expect(formatted).toContain("HTTP 403");
    expect(formatted).toContain("ErrorCode=CMN-401");
    expect(formatted).toContain("RequestId=req-456");
    expect(formatted).toContain("AccountId=work");
    expect(formatted).toContain('Message="Permission denied"');
    expect(formatted).toContain("ERR-1: Missing scope (scope)");
  });

  it("returns 'Unknown error' for empty info", () => {
    const formatted = formatRcApiError({});
    expect(formatted).toBe("Unknown error");
  });

  it("formats partial error info", () => {
    const info = {
      httpStatus: 500,
      errorMessage: "Internal server error",
    };
    const formatted = formatRcApiError(info);
    expect(formatted).toContain("HTTP 500");
    expect(formatted).toContain('Message="Internal server error"');
    expect(formatted).not.toContain("ErrorCode");
  });
});

describe("Adaptive Card API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getRingCentralAdaptiveCard should be exported", async () => {
    const { getRingCentralAdaptiveCard } = await import("./api.js");
    expect(typeof getRingCentralAdaptiveCard).toBe("function");
  });

  it("sendRingCentralAdaptiveCard should be exported", async () => {
    const { sendRingCentralAdaptiveCard } = await import("./api.js");
    expect(typeof sendRingCentralAdaptiveCard).toBe("function");
  });

  it("updateRingCentralAdaptiveCard should be exported", async () => {
    const { updateRingCentralAdaptiveCard } = await import("./api.js");
    expect(typeof updateRingCentralAdaptiveCard).toBe("function");
  });

  it("deleteRingCentralAdaptiveCard should be exported", async () => {
    const { deleteRingCentralAdaptiveCard } = await import("./api.js");
    expect(typeof deleteRingCentralAdaptiveCard).toBe("function");
  });
});

describe("Chat API", () => {
  it("getRingCentralChat should be exported", async () => {
    const { getRingCentralChat } = await import("./api.js");
    expect(typeof getRingCentralChat).toBe("function");
  });

  it("listRingCentralChats should be exported", async () => {
    const { listRingCentralChats } = await import("./api.js");
    expect(typeof listRingCentralChats).toBe("function");
  });
});

describe("Conversation API", () => {
  it("listRingCentralConversations should be exported", async () => {
    const { listRingCentralConversations } = await import("./api.js");
    expect(typeof listRingCentralConversations).toBe("function");
  });

  it("getRingCentralConversation should be exported", async () => {
    const { getRingCentralConversation } = await import("./api.js");
    expect(typeof getRingCentralConversation).toBe("function");
  });

  it("createRingCentralConversation should be exported", async () => {
    const { createRingCentralConversation } = await import("./api.js");
    expect(typeof createRingCentralConversation).toBe("function");
  });
});

describe("Post API", () => {
  it("getRingCentralPost should be exported", async () => {
    const { getRingCentralPost } = await import("./api.js");
    expect(typeof getRingCentralPost).toBe("function");
  });

  it("listRingCentralPosts should be exported", async () => {
    const { listRingCentralPosts } = await import("./api.js");
    expect(typeof listRingCentralPosts).toBe("function");
  });
});

describe("Message API", () => {
  it("sendRingCentralMessage should be exported", async () => {
    const { sendRingCentralMessage } = await import("./api.js");
    expect(typeof sendRingCentralMessage).toBe("function");
  });

  it("updateRingCentralMessage should be exported", async () => {
    const { updateRingCentralMessage } = await import("./api.js");
    expect(typeof updateRingCentralMessage).toBe("function");
  });

  it("deleteRingCentralMessage should be exported", async () => {
    const { deleteRingCentralMessage } = await import("./api.js");
    expect(typeof deleteRingCentralMessage).toBe("function");
  });
});

describe("User API", () => {
  it("getRingCentralUser should be exported", async () => {
    const { getRingCentralUser } = await import("./api.js");
    expect(typeof getRingCentralUser).toBe("function");
  });

  it("getCurrentRingCentralUser should be exported", async () => {
    const { getCurrentRingCentralUser } = await import("./api.js");
    expect(typeof getCurrentRingCentralUser).toBe("function");
  });
});

describe("Company API", () => {
  it("getRingCentralCompanyInfo should be exported", async () => {
    const { getRingCentralCompanyInfo } = await import("./api.js");
    expect(typeof getRingCentralCompanyInfo).toBe("function");
  });
});

describe("Attachment API", () => {
  it("uploadRingCentralAttachment should be exported", async () => {
    const { uploadRingCentralAttachment } = await import("./api.js");
    expect(typeof uploadRingCentralAttachment).toBe("function");
  });

  it("downloadRingCentralAttachment should be exported", async () => {
    const { downloadRingCentralAttachment } = await import("./api.js");
    expect(typeof downloadRingCentralAttachment).toBe("function");
  });
});

describe("downloadRingCentralAttachment", () => {
  it("rejects when content-length exceeds max bytes", async () => {
    const { getRingCentralPlatform } = await import("./auth.js");
    const { downloadRingCentralAttachment } = await import("./api.js");
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const response = new Response(body, {
      status: 200,
      headers: { "content-length": "50", "content-type": "application/octet-stream" },
    });
    vi.mocked(getRingCentralPlatform).mockResolvedValue({ get: vi.fn().mockResolvedValue(response) } as any);

    await expect(
      downloadRingCentralAttachment({ account: mockAccount, contentUri: "/media/123", maxBytes: 10 }),
    ).rejects.toThrow(/max bytes/i);
  });

  it("rejects when streamed payload exceeds max bytes", async () => {
    const { getRingCentralPlatform } = await import("./auth.js");
    const { downloadRingCentralAttachment } = await import("./api.js");
    const chunks = [new Uint8Array(6), new Uint8Array(6)];
    let index = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(chunks[index++]);
        } else {
          controller.close();
        }
      },
    });
    const response = new Response(body, {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });
    vi.mocked(getRingCentralPlatform).mockResolvedValue({ get: vi.fn().mockResolvedValue(response) } as any);

    await expect(
      downloadRingCentralAttachment({ account: mockAccount, contentUri: "/media/123", maxBytes: 10 }),
    ).rejects.toThrow(/max bytes/i);
  });

  it("downloads successfully within max bytes", async () => {
    const { getRingCentralPlatform } = await import("./auth.js");
    const { downloadRingCentralAttachment } = await import("./api.js");
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
    const response = new Response(body, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
    vi.mocked(getRingCentralPlatform).mockResolvedValue({ get: vi.fn().mockResolvedValue(response) } as any);

    const result = await downloadRingCentralAttachment({ account: mockAccount, contentUri: "/media/123", maxBytes: 100 });
    expect(result.buffer.length).toBe(5);
    expect(result.contentType).toBe("image/png");
  });
});

describe("Favorite Chats API", () => {
  it("listRingCentralFavoriteChats should be exported", async () => {
    const { listRingCentralFavoriteChats } = await import("./api.js");
    expect(typeof listRingCentralFavoriteChats).toBe("function");
  });

  it("addRingCentralFavoriteChat should be exported", async () => {
    const { addRingCentralFavoriteChat } = await import("./api.js");
    expect(typeof addRingCentralFavoriteChat).toBe("function");
  });

  it("removeRingCentralFavoriteChat should be exported", async () => {
    const { removeRingCentralFavoriteChat } = await import("./api.js");
    expect(typeof removeRingCentralFavoriteChat).toBe("function");
  });
});

describe("Tasks API", () => {
  it("listRingCentralTasks should be exported", async () => {
    const { listRingCentralTasks } = await import("./api.js");
    expect(typeof listRingCentralTasks).toBe("function");
  });

  it("createRingCentralTask should be exported", async () => {
    const { createRingCentralTask } = await import("./api.js");
    expect(typeof createRingCentralTask).toBe("function");
  });

  it("getRingCentralTask should be exported", async () => {
    const { getRingCentralTask } = await import("./api.js");
    expect(typeof getRingCentralTask).toBe("function");
  });

  it("updateRingCentralTask should be exported", async () => {
    const { updateRingCentralTask } = await import("./api.js");
    expect(typeof updateRingCentralTask).toBe("function");
  });

  it("deleteRingCentralTask should be exported", async () => {
    const { deleteRingCentralTask } = await import("./api.js");
    expect(typeof deleteRingCentralTask).toBe("function");
  });

  it("completeRingCentralTask should be exported", async () => {
    const { completeRingCentralTask } = await import("./api.js");
    expect(typeof completeRingCentralTask).toBe("function");
  });
});

describe("Calendar Events API", () => {
  it("listRingCentralEvents should be exported", async () => {
    const { listRingCentralEvents } = await import("./api.js");
    expect(typeof listRingCentralEvents).toBe("function");
  });

  it("createRingCentralEvent should be exported", async () => {
    const { createRingCentralEvent } = await import("./api.js");
    expect(typeof createRingCentralEvent).toBe("function");
  });

  it("getRingCentralEvent should be exported", async () => {
    const { getRingCentralEvent } = await import("./api.js");
    expect(typeof getRingCentralEvent).toBe("function");
  });

  it("updateRingCentralEvent should be exported", async () => {
    const { updateRingCentralEvent } = await import("./api.js");
    expect(typeof updateRingCentralEvent).toBe("function");
  });

  it("deleteRingCentralEvent should be exported", async () => {
    const { deleteRingCentralEvent } = await import("./api.js");
    expect(typeof deleteRingCentralEvent).toBe("function");
  });
});

describe("Notes API", () => {
  it("listRingCentralNotes should be exported", async () => {
    const { listRingCentralNotes } = await import("./api.js");
    expect(typeof listRingCentralNotes).toBe("function");
  });

  it("createRingCentralNote should be exported", async () => {
    const { createRingCentralNote } = await import("./api.js");
    expect(typeof createRingCentralNote).toBe("function");
  });

  it("getRingCentralNote should be exported", async () => {
    const { getRingCentralNote } = await import("./api.js");
    expect(typeof getRingCentralNote).toBe("function");
  });

  it("updateRingCentralNote should be exported", async () => {
    const { updateRingCentralNote } = await import("./api.js");
    expect(typeof updateRingCentralNote).toBe("function");
  });

  it("deleteRingCentralNote should be exported", async () => {
    const { deleteRingCentralNote } = await import("./api.js");
    expect(typeof deleteRingCentralNote).toBe("function");
  });

  it("lockRingCentralNote should be exported", async () => {
    const { lockRingCentralNote } = await import("./api.js");
    expect(typeof lockRingCentralNote).toBe("function");
  });

  it("unlockRingCentralNote should be exported", async () => {
    const { unlockRingCentralNote } = await import("./api.js");
    expect(typeof unlockRingCentralNote).toBe("function");
  });

  it("publishRingCentralNote should be exported", async () => {
    const { publishRingCentralNote } = await import("./api.js");
    expect(typeof publishRingCentralNote).toBe("function");
  });
});

describe("Incoming Webhooks API", () => {
  it("listRingCentralWebhooks should be exported", async () => {
    const { listRingCentralWebhooks } = await import("./api.js");
    expect(typeof listRingCentralWebhooks).toBe("function");
  });

  it("createRingCentralWebhook should be exported", async () => {
    const { createRingCentralWebhook } = await import("./api.js");
    expect(typeof createRingCentralWebhook).toBe("function");
  });

  it("getRingCentralWebhook should be exported", async () => {
    const { getRingCentralWebhook } = await import("./api.js");
    expect(typeof getRingCentralWebhook).toBe("function");
  });

  it("deleteRingCentralWebhook should be exported", async () => {
    const { deleteRingCentralWebhook } = await import("./api.js");
    expect(typeof deleteRingCentralWebhook).toBe("function");
  });

  it("activateRingCentralWebhook should be exported", async () => {
    const { activateRingCentralWebhook } = await import("./api.js");
    expect(typeof activateRingCentralWebhook).toBe("function");
  });

  it("suspendRingCentralWebhook should be exported", async () => {
    const { suspendRingCentralWebhook } = await import("./api.js");
    expect(typeof suspendRingCentralWebhook).toBe("function");
  });
});

describe("Teams API", () => {
  it("listRingCentralTeams should be exported", async () => {
    const { listRingCentralTeams } = await import("./api.js");
    expect(typeof listRingCentralTeams).toBe("function");
  });

  it("createRingCentralTeam should be exported", async () => {
    const { createRingCentralTeam } = await import("./api.js");
    expect(typeof createRingCentralTeam).toBe("function");
  });

  it("getRingCentralTeam should be exported", async () => {
    const { getRingCentralTeam } = await import("./api.js");
    expect(typeof getRingCentralTeam).toBe("function");
  });

  it("updateRingCentralTeam should be exported", async () => {
    const { updateRingCentralTeam } = await import("./api.js");
    expect(typeof updateRingCentralTeam).toBe("function");
  });

  it("deleteRingCentralTeam should be exported", async () => {
    const { deleteRingCentralTeam } = await import("./api.js");
    expect(typeof deleteRingCentralTeam).toBe("function");
  });

  it("joinRingCentralTeam should be exported", async () => {
    const { joinRingCentralTeam } = await import("./api.js");
    expect(typeof joinRingCentralTeam).toBe("function");
  });

  it("leaveRingCentralTeam should be exported", async () => {
    const { leaveRingCentralTeam } = await import("./api.js");
    expect(typeof leaveRingCentralTeam).toBe("function");
  });

  it("addRingCentralTeamMembers should be exported", async () => {
    const { addRingCentralTeamMembers } = await import("./api.js");
    expect(typeof addRingCentralTeamMembers).toBe("function");
  });

  it("removeRingCentralTeamMembers should be exported", async () => {
    const { removeRingCentralTeamMembers } = await import("./api.js");
    expect(typeof removeRingCentralTeamMembers).toBe("function");
  });

  it("archiveRingCentralTeam should be exported", async () => {
    const { archiveRingCentralTeam } = await import("./api.js");
    expect(typeof archiveRingCentralTeam).toBe("function");
  });

  it("unarchiveRingCentralTeam should be exported", async () => {
    const { unarchiveRingCentralTeam } = await import("./api.js");
    expect(typeof unarchiveRingCentralTeam).toBe("function");
  });
});

describe("probeRingCentral", () => {
  it("should be exported", async () => {
    const { probeRingCentral } = await import("./api.js");
    expect(typeof probeRingCentral).toBe("function");
  });
});
