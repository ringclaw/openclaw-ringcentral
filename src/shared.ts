// Shared constants and plugin base utilities.

export const RINGCENTRAL_CHANNEL_ID = "ringcentral";

export const RINGCENTRAL_META = {
  label: "RingCentral",
  docsPath: "/channels/ringcentral",
  docsLabel: "ringcentral",
  blurb: "RingCentral Team Messaging via REST API and WebSocket.",
};

export const RINGCENTRAL_CAPABILITIES = {
  chatTypes: ["direct", "group", "channel"] as Array<"direct" | "group" | "channel">,
  media: true,
  edit: true,
  threads: false,
  reactions: false,
};

export const DEFAULT_TEXT_CHUNK_LIMIT = 4000;
export const DEFAULT_SERVER = "https://platform.ringcentral.com";

// Answer wrapper markers — used to detect own messages
export const ANSWER_START = "--------answer--------";
export const THINKING_TEXT = "Thinking...";
