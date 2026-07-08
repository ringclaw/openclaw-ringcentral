import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";

import { registerRingCentralArtifactToolHook } from "./src/artifact-tool-hook.js";
import { ringcentralPlugin } from "./src/channel.js";
import { ringCentralConfigSchema } from "./src/config-schema.js";
import { setRingCentralRuntime } from "./src/runtime.js";

const plugin = {
  id: "openclaw-ringcentral",
  name: "RingCentral",
  description: "RingCentral Team Messaging for OpenClaw with DM, Team, Group DM, and artifact tools",
  configSchema: buildChannelConfigSchema(ringCentralConfigSchema),
  register(api: OpenClawPluginApi) {
    setRingCentralRuntime(api.runtime);
    registerRingCentralArtifactToolHook(api);
    api.registerChannel({ plugin: ringcentralPlugin });
  },
};

export default plugin;
