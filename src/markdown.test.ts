import { describe, it, expect } from "vitest";
import { markdownToMiniMarkdown, chunkText, extractImageUrls } from "./markdown.js";

describe("markdownToMiniMarkdown", () => {
  it("converts headers to bold", () => {
    expect(markdownToMiniMarkdown("# Hello")).toBe("**Hello**");
    expect(markdownToMiniMarkdown("## World")).toBe("**World**");
  });

  it("strips code fences", () => {
    const input = "```js\nconst x = 1;\n```";
    expect(markdownToMiniMarkdown(input)).toBe("const x = 1;");
  });

  it("strips inline code backticks", () => {
    expect(markdownToMiniMarkdown("Use `foo()` here")).toBe("Use foo() here");
  });

  it("keeps links", () => {
    expect(markdownToMiniMarkdown("[click](https://example.com)")).toBe("[click](https://example.com)");
  });

  it("converts image to URL", () => {
    expect(markdownToMiniMarkdown("![alt](https://img.png)")).toBe("https://img.png");
  });

  it("preserves plain text", () => {
    expect(markdownToMiniMarkdown("hello world")).toBe("hello world");
  });
});

describe("chunkText", () => {
  it("returns single chunk for short text", () => {
    expect(chunkText("hello", 100)).toEqual(["hello"]);
  });

  it("splits long text", () => {
    const chunks = chunkText("line1\nline2\nline3", 10);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe("extractImageUrls", () => {
  it("extracts image URLs", () => {
    const urls = extractImageUrls("![img](https://example.com/a.png) text ![b](https://example.com/b.jpg)");
    expect(urls).toEqual(["https://example.com/a.png", "https://example.com/b.jpg"]);
  });

  it("returns empty for no images", () => {
    expect(extractImageUrls("no images here")).toEqual([]);
  });
});
