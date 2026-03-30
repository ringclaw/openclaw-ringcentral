// Runtime store for the plugin.
// PluginRuntime is set during registration and provides access to SDK functions.

import type { PluginRuntime } from "openclaw/plugin-sdk";

let _runtime: PluginRuntime | null = null;

export function setRingCentralRuntime(runtime: PluginRuntime): void {
  _runtime = runtime;
}

export function getRingCentralRuntime(): PluginRuntime {
  if (!_runtime) {
    throw new Error("RingCentral plugin runtime not initialized.");
  }
  return _runtime;
}

export function tryGetRingCentralRuntime(): PluginRuntime | null {
  return _runtime;
}
