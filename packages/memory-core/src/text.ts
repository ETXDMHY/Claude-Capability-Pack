const CJK_RE = /[\u3400-\u9fff]/;

export function clampText(input: string, maxChars: number): string {
  const text = input.replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function firstUsefulLine(input: string): string {
  const line = input
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value && !value.startsWith("#"));
  return line || input.trim();
}

export function tokenize(input: string): string[] {
  const normalized = input.toLowerCase();
  const tokens = new Set<string>();

  for (const match of normalized.matchAll(/[a-z0-9_+-]{2,}/g)) {
    tokens.add(match[0]);
  }

  const cjkChars = Array.from(normalized).filter((char) => CJK_RE.test(char));
  if (cjkChars.length === 1) {
    tokens.add(cjkChars[0]);
  }
  for (let index = 0; index < cjkChars.length - 1; index += 1) {
    tokens.add(`${cjkChars[index]}${cjkChars[index + 1]}`);
  }

  return Array.from(tokens);
}

export function countTokenOverlap(queryTokens: string[], target: string): number {
  if (!queryTokens.length) {
    return 0;
  }
  const targetTokens = new Set(tokenize(target));
  let count = 0;
  for (const token of queryTokens) {
    if (targetTokens.has(token)) {
      count += 1;
    }
  }
  return count;
}
