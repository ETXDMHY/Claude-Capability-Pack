import { tokenize } from "./text";

export interface Bm25Document {
  id: string;
  text: string;
}

export interface Bm25Options {
  k1?: number;
  b?: number;
}

export function scoreBm25(
  documents: Bm25Document[],
  query: string,
  options: Bm25Options = {}
): Map<string, number> {
  const queryTokens = Array.from(new Set(tokenize(query)));
  if (!documents.length || !queryTokens.length) {
    return new Map();
  }

  const k1 = options.k1 ?? 1.2;
  const b = options.b ?? 0.75;
  const tokenized = documents.map((document) => ({ id: document.id, tokens: tokenize(document.text) }));
  const averageLength = tokenized.reduce((sum, document) => sum + document.tokens.length, 0) / tokenized.length || 1;
  const documentFrequency = new Map<string, number>();

  for (const document of tokenized) {
    const unique = new Set(document.tokens);
    for (const token of queryTokens) {
      if (unique.has(token)) {
        documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
      }
    }
  }

  const scores = new Map<string, number>();
  for (const document of tokenized) {
    const frequencies = new Map<string, number>();
    for (const token of document.tokens) {
      frequencies.set(token, (frequencies.get(token) || 0) + 1);
    }

    let score = 0;
    for (const token of queryTokens) {
      const frequency = frequencies.get(token) || 0;
      if (!frequency) continue;
      const df = documentFrequency.get(token) || 0;
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
      const normalization = frequency + k1 * (1 - b + b * document.tokens.length / averageLength);
      score += idf * (frequency * (k1 + 1)) / normalization;
    }
    if (score > 0) scores.set(document.id, score);
  }

  return scores;
}
