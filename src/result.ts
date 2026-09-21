export function ok<T>(structured: T): {
  content: [{ type: "text"; text: string }];
  structuredContent: T;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
}
