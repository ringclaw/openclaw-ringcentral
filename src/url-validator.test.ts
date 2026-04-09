import { describe, it, expect } from "vitest";
import { validateMediaUrl } from "./url-validator.js";

describe("validateMediaUrl", () => {
  it("allows valid https URLs", () => {
    expect(() => validateMediaUrl("https://example.com/image.png")).not.toThrow();
    expect(() => validateMediaUrl("https://cdn.example.com/file.jpg")).not.toThrow();
  });

  it("blocks http protocol", () => {
    expect(() => validateMediaUrl("http://example.com/image.png")).toThrow("Blocked protocol");
  });

  it("blocks file protocol", () => {
    expect(() => validateMediaUrl("file:///etc/passwd")).toThrow("Blocked protocol");
  });

  it("blocks data protocol", () => {
    expect(() => validateMediaUrl("data:text/html,test")).toThrow("Blocked protocol");
  });

  it("blocks javascript protocol", () => {
    expect(() => validateMediaUrl("javascript:alert(1)")).toThrow("Blocked protocol");
  });

  it("blocks localhost", () => {
    expect(() => validateMediaUrl("https://localhost/secret")).toThrow("Blocked host");
    expect(() => validateMediaUrl("https://localhost.localdomain/x")).toThrow("Blocked host");
  });

  it("blocks .local domains", () => {
    expect(() => validateMediaUrl("https://server.local/data")).toThrow("Blocked host");
  });

  it("blocks .internal domains", () => {
    expect(() => validateMediaUrl("https://metadata.google.internal/v1")).toThrow("Blocked host");
    expect(() => validateMediaUrl("https://corp.internal/api")).toThrow("Blocked host");
  });

  it("blocks loopback IP 127.x.x.x", () => {
    expect(() => validateMediaUrl("https://127.0.0.1/file")).toThrow("Blocked private IP");
    expect(() => validateMediaUrl("https://127.0.0.2/file")).toThrow("Blocked private IP");
  });

  it("blocks 10.x.x.x (RFC 1918)", () => {
    expect(() => validateMediaUrl("https://10.0.0.1/file")).toThrow("Blocked private IP");
    expect(() => validateMediaUrl("https://10.255.255.255/file")).toThrow("Blocked private IP");
  });

  it("blocks 172.16-31.x.x (RFC 1918)", () => {
    expect(() => validateMediaUrl("https://172.16.0.1/file")).toThrow("Blocked private IP");
    expect(() => validateMediaUrl("https://172.31.255.255/file")).toThrow("Blocked private IP");
  });

  it("allows 172.15.x.x and 172.32.x.x", () => {
    expect(() => validateMediaUrl("https://172.15.0.1/file")).not.toThrow();
    expect(() => validateMediaUrl("https://172.32.0.1/file")).not.toThrow();
  });

  it("blocks 192.168.x.x (RFC 1918)", () => {
    expect(() => validateMediaUrl("https://192.168.1.1/file")).toThrow("Blocked private IP");
  });

  it("blocks 169.254.x.x (link-local)", () => {
    expect(() => validateMediaUrl("https://169.254.169.254/metadata")).toThrow("Blocked private IP");
  });

  it("blocks 0.0.0.0", () => {
    expect(() => validateMediaUrl("https://0.0.0.0/file")).toThrow("Blocked private IP");
  });

  it("blocks IPv6 loopback", () => {
    expect(() => validateMediaUrl("https://[::1]/file")).toThrow("Blocked private IP");
  });

  it("throws on invalid URLs", () => {
    expect(() => validateMediaUrl("not-a-url")).toThrow("Invalid media URL");
  });
});
