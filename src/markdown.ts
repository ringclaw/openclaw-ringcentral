// Markdown → RingCentral Mini-Markdown converter.
// Ported from RingClaw messaging/markdown.go.

export function markdownToMiniMarkdown(text: string): string {
  let result = text;

  // Convert headers to bold
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "**$1**");

  // Strip code fences but keep content
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    const inner = match.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, "");
    return inner;
  });

  // Strip inline code backticks
  result = result.replace(/`([^`]+)`/g, "$1");

  // Convert markdown images to just URL
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$2");

  // Keep links as-is — RC supports [text](url)

  // Strip horizontal rules
  result = result.replace(/^[-*_]{3,}\s*$/gm, "");

  // Clean up excessive blank lines
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

export function extractImageUrls(text: string): string[] {
  const urls: string[] = [];
  const regex = /!\[(?:[^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

export function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt <= 0) splitAt = limit;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }
  return chunks;
}
