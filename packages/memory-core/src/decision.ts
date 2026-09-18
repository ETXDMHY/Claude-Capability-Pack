import { MemoryQuery } from "./types";

const HISTORY_PATTERNS = [
  "之前",
  "上次",
  "刚才",
  "不是跟你说过",
  "我不是",
  "还记得",
  "以前",
  "那个",
  "后来怎么样",
];

const CJK_ENTITY_STOPWORDS = new Set([
  "今天",
  "明天",
  "昨天",
  "现在",
  "这个",
  "那个",
  "什么",
  "怎么",
  "为什么",
  "是不是",
  "有没有",
  "可以",
  "一下",
  "起来",
  "知道",
  "记得",
  "说过",
  "好的",
  "好吧",
  "好呀",
  "谢谢",
  "没事",
  "不用",
  "知道了",
  "继续吧",
]);

const DAILY_CHATTER_RE = /^(我|我们|Reiko)?(今天|昨天|明天|刚刚|现在).*(吃|喝|买|看|去了|做了|睡|醒|到家|出门)/i;

export function buildQueries(input: string, recentContext = ""): MemoryQuery[] {
  const text = input.trim();
  if (!text) {
    return [];
  }
  if (DAILY_CHATTER_RE.test(text) && !HISTORY_PATTERNS.some((pattern) => text.includes(pattern))) {
    return [];
  }

  const queries: MemoryQuery[] = [];
  if (HISTORY_PATTERNS.some((pattern) => text.includes(pattern))) {
    queries.push({ kind: "reference", text: [text, recentContext].filter(Boolean).join("\n") });
  }

  if (looksLikeContinuityRequest(text)) {
    queries.push({ kind: "explicit", text });
  }

  const entities = extractEntities(text);
  for (const entity of entities.slice(0, 2)) {
    queries.push({ kind: "entity", text: entity });
  }

  return dedupeQueries(queries).slice(0, 3);
}

function extractEntities(input: string): string[] {
  const entities = new Set<string>();
  for (const match of input.matchAll(/[A-Za-z][A-Za-z0-9_-]{2,}/g)) {
    entities.add(match[0]);
  }
  for (const match of input.matchAll(/[《「『“"]([^《》「」『』“”"]{2,24})[》」』”"]/g)) {
    entities.add(match[1]);
  }
  if (shouldExtractCjkEntities(input)) {
    for (const match of input.matchAll(/[\u3400-\u9fff]{2,12}/g)) {
      const value = trimCjkEntity(match[0]);
      if (value.length >= 2 && !CJK_ENTITY_STOPWORDS.has(value)) {
        entities.add(value);
      }
    }
  }
  return Array.from(entities);
}

function shouldExtractCjkEntities(input: string): boolean {
  return /是什么|怎么回事|关于|还记得|记得|说过|之前|上次|那个|这个|查一下|找一下|说说|聊聊|讲讲|提一下/.test(input)
    || looksLikeShortCjkTopic(input);
}

function trimCjkEntity(input: string): string {
  return input
    .replace(/^(我想问|我问|关于|那个|这个|请问|你知道|还记得|记得|说说|聊聊|讲讲|提一下)/, "")
    .replace(/(是什么|怎么样|怎么回事|这件事|的问题|的时候|那天|相关|有关|吗|呢|吧|呀|啊)$/g, "")
    .trim();
}

function looksLikeShortCjkTopic(input: string): boolean {
  const text = input.replace(/[\s，。！？、,.!?《》「」『』“”"'（）()]/g, "").trim();
  if (text.length < 2 || text.length > 8 || !/^[\u3400-\u9fff]+$/.test(text)) {
    return false;
  }
  if (CJK_ENTITY_STOPWORDS.has(text) || DAILY_CHATTER_RE.test(text)) {
    return false;
  }
  return true;
}

function looksLikeContinuityRequest(input: string): boolean {
  return /继续|沿用|照旧|方案|项目|记忆|偏好|设定/.test(input);
}

function dedupeQueries(queries: MemoryQuery[]): MemoryQuery[] {
  const seen = new Set<string>();
  return queries.filter((query) => {
    const key = `${query.kind}:${query.text}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
