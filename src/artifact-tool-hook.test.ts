import { describe, expect, it } from "vitest";
import { injectRingCentralArtifactToolChatId } from "./artifact-tool-hook.js";

describe("RingCentral artifact tool hook", () => {
  it("injects the current RingCentral group chat as chat_id for artifact tools without a target", () => {
    const result = injectRingCentralArtifactToolChatId(
      {
        toolName: "ringcentral_create_note",
        params: { title: "Note" },
      },
      {
        sessionKey: "agent:main:ringcentral:channel:team-1",
        channelId: "team-1",
      },
    );

    expect(result).toEqual({
      params: {
        title: "Note",
        chat_id: "team-1",
      },
    });
  });

  it("preserves explicit artifact targets", () => {
    const result = injectRingCentralArtifactToolChatId(
      {
        toolName: "ringcentral_create_note",
        params: { chat_id: "explicit-team", title: "Note" },
      },
      {
        sessionKey: "agent:main:ringcentral:channel:team-1",
        channelId: "team-1",
      },
    );

    expect(result).toBeUndefined();
  });

  it("does not inject for non-artifact RingCentral tools", () => {
    const result = injectRingCentralArtifactToolChatId(
      {
        toolName: "ringcentral_get_recent_messages",
        params: {},
      },
      {
        sessionKey: "agent:main:ringcentral:channel:team-1",
        channelId: "team-1",
      },
    );

    expect(result).toBeUndefined();
  });

  it("does not inject for non-RingCentral sessions", () => {
    const result = injectRingCentralArtifactToolChatId(
      {
        toolName: "ringcentral_create_note",
        params: { title: "Note" },
      },
      {
        sessionKey: "agent:main:slack:channel:C123",
        channelId: "C123",
      },
    );

    expect(result).toBeUndefined();
  });

  it("does not inject confirmation targets", () => {
    const result = injectRingCentralArtifactToolChatId(
      {
        toolName: "ringcentral_confirm_artifact_action",
        params: { confirmation_id: "confirm-1" },
      },
      {
        sessionKey: "agent:main:ringcentral:channel:team-1",
        channelId: "team-1",
      },
    );

    expect(result).toBeUndefined();
  });
});
