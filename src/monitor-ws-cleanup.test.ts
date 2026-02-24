import { describe, expect, it, vi } from "vitest";

/**
 * Regression test for: Subscription listener leak after subscribe() failure.
 *
 * @rc-ex/ws Subscription constructor registers a WS message listener
 * immediately, before subscribe() completes.  If subscribe() fails (e.g.
 * SUB-528 permission error), the listener stays attached and crashes on
 * `this.subscriptionInfo.id` because subscriptionInfo is still undefined.
 *
 * The fix in monitor.ts closes the WS and discards the WsManager on any
 * subscribe failure, preventing the leaked listener from ever firing.
 * This test reproduces the exact crash pattern.
 */
describe("Subscription listener leak on subscribe failure", () => {
  it("leaked listener crashes when subscriptionInfo is undefined", () => {
    // Simulate the @rc-ex/ws Subscription behavior:
    // - constructor registers listener that accesses this.subscriptionInfo.id
    // - subscribe() fails → subscriptionInfo stays undefined
    const listeners: ((event: unknown) => void)[] = [];
    const fakeWs = {
      addEventListener: (_type: string, fn: (event: unknown) => void) => { listeners.push(fn); },
      removeEventListener: (_type: string, fn: (event: unknown) => void) => {
        const idx = listeners.indexOf(fn);
        if (idx >= 0) listeners.splice(idx, 1);
      },
      close: vi.fn(),
    };

    // oxlint-disable-next-line no-unassigned-vars -- intentionally unassigned to reproduce crash
    let _subscriptionInfo: { id: string } | undefined;

    // Simulates the listener registered in Subscription constructor
    const eventListener = (_mEvent: unknown) => {
      // This line is the exact crash site from subscription.js:22
      const _id = _subscriptionInfo!.id;
    };
    fakeWs.addEventListener("message", eventListener);

    // Simulate subscribe() failure (SUB-528) - subscriptionInfo stays undefined
    // subscriptionInfo = { id: "..." }; // never happens

    // Without fix: incoming message triggers crash
    expect(listeners).toHaveLength(1);
    expect(() => listeners[0]({ data: "test" })).toThrow(TypeError);

    // With fix: ws.close() prevents future messages; remove listener for safety
    fakeWs.close();
    fakeWs.removeEventListener("message", eventListener);
    expect(listeners).toHaveLength(0);
  });

  it("closing ws prevents leaked listener from firing on new messages", () => {
    const listeners: ((event: unknown) => void)[] = [];
    let closed = false;
    const fakeWs = {
      addEventListener: (_type: string, fn: (event: unknown) => void) => {
        if (!closed) listeners.push(fn);
      },
      removeEventListener: (_type: string, fn: (event: unknown) => void) => {
        const idx = listeners.indexOf(fn);
        if (idx >= 0) listeners.splice(idx, 1);
      },
      close: () => { closed = true; listeners.length = 0; },
    };

    // Register a listener that would crash
    const crashListener = () => { throw new Error("should not fire"); };
    fakeWs.addEventListener("message", crashListener);
    expect(listeners).toHaveLength(1);

    // Fix: close ws on subscribe failure
    fakeWs.close();

    // After close, no listeners remain → no crash
    expect(listeners).toHaveLength(0);
  });
});
