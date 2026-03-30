import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { ringcentralPlugin, ringcentralDock } from "./src/channel.js";
import { setRingCentralRuntime } from "./src/runtime.js";

const plugin = {
  id: "openclaw-ringcentral",
  name: "RingCentral",
  description: "OpenClaw RingCentral Team Messaging channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setRingCentralRuntime(api.runtime);
    api.registerChannel({ plugin: ringcentralPlugin, dock: ringcentralDock });
  },
};

export default plugin;
