import { clampText } from "./text";
import { BucketType, MemoryScope } from "./types";
import { CreateMemoryInput, makeMemoryId } from "./write";

export interface SummaryMemoryCandidate {
  sourceLine: string;
  memory: CreateMemoryInput;
}

export interface SummaryCaptureOptions {
  now?: string;
  scope?: MemoryScope;
  sourceId?: string;
  pinCore?: boolean;
}

const HEADING_RE = /^(#+\s*)?(用户|user|偏好|preference|事实|fact|设定|profile|关系|relationship|计划|plan|项目|project|记忆|memory|用户信息|用户偏好|长期记忆|重要事实|关系状态|对话记忆|后续计划|项目状态|summary)[：:\s]/i;
const NOISE_RE = /^(本轮|这次|当前|助手|assistant|模型|model|回复|回答|工具|调用|token|上下文|摘要|已完成)[：:\s]/i;
const MEMORY_SIGNAL_RE = /(喜欢|不喜欢|偏好|希望|要求|习惯|称呼|关系|承诺|约定|接受|不同意|不同意见|不换|没变|冷淡期|挽回|修复|等待|项目|路径|目录|工具包|插件|计划|下一步|后续|以后|记住|长期|固定|设定|需要|想要|决定|确认|使用|保存)/i;
const TRANSIENT_RE = /(几点了|睡够|午饭|早饭|晚饭|刚刚|此刻|现在的感觉|今天做什么|想和你说话|想知道你今天|测试.*状态|本轮回应|详细回应)/i;
const AMBIGUOUS_RE = /(这件事|这个|这些|那件事|昨晚说的话|上轮|上次说的)/i;
const SPEAKER_RE = /^(Claude|Gabe|Reiko|用户|User)\s*(?:说|表示|回应)?[：:]?\s*/i;

export function extractMemoriesFromSummary(
  summary: string,
  options: SummaryCaptureOptions = {}
): SummaryMemoryCandidate[] {
  const now = options.now || new Date().toISOString();
  const lines = summaryToCandidateLines(summary);
  const seen = new Set<string>();
  const candidates: SummaryMemoryCandidate[] = [];

  for (const line of lines) {
    const normalized = normalizeMemoryLine(line);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);

    const type = inferType(normalized);
    const domain = inferDomain(normalized, type);
    const coreSummary = clampText(normalized, 96);
    const body = buildMemoryBody(normalized, line);
    const seed = [options.sourceId || "summary", options.scope?.characterId || "", normalized].join(":");
    candidates.push({
      sourceLine: line,
      memory: {
        id: makeMemoryId(seed, "summary-capture"),
        type,
        domain,
        tags: inferTags(normalized, type),
        title: titleFor(type, normalized),
        body,
        coreSummary,
        importance: inferImportance(normalized, type),
        source: "summary",
        sourceId: options.sourceId,
        now,
        pinned: Boolean(options.pinCore && (type === "permanent" || type === "feel")),
        pinnedOrder: 1000,
        pinnedScope: options.scope?.characterId ? "character" : "global",
        characterId: options.scope?.characterId,
        chatId: options.scope?.chatId,
        projectId: options.scope?.projectId,
      },
    });
  }

  return candidates.slice(0, 8);
}

function buildMemoryBody(conclusion: string, sourceLine: string): string {
  const detail = cleanMemoryDetail(sourceLine);
  const normalizedConclusion = comparableText(conclusion);
  const normalizedDetail = comparableText(detail);

  if (!detail || normalizedDetail === normalizedConclusion || normalizedDetail.includes(normalizedConclusion)) {
    return clampMemoryBody(conclusion, 600);
  }

  return clampMemoryBody(`记忆结论：${conclusion}\n发生经过：${detail}`, 600);
}

function clampMemoryBody(value: string, maxChars: number): string {
  const text = value
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function cleanMemoryDetail(sourceLine: string): string {
  return sourceLine
    .replace(/\*\*/g, "")
    .replace(/\b(Claude|Gabe|Reiko)#\d+\b/gi, "$1")
    .replace(/#\d+(?:\s*[-~至]\s*#?\d+)?/g, "")
    .replace(/^[-*•\d.、)）①-⑳\s]+/, "")
    .replace(/\s+/g, " ")
    .replace(/^[：:,，\s]+|[：:,，\s]+$/g, "")
    .trim();
}

function comparableText(value: string): string {
  return value
    .replace(/^(记忆结论|发生经过)[：:]\s*/g, "")
    .replace(/[“”"'。！？!?；;，,：:\s]/g, "")
    .toLowerCase();
}

function summaryToCandidateLines(summary: string): string[] {
  const text = summary
    .replace(/\[Core memory\][\s\S]*?\[End Core memory\]/g, "")
    .replace(/\[Temporary memory context\][\s\S]*?\[End Temporary memory context\]/g, "")
    .replace(/\*\*/g, "")
    .replace(/[（(]\s*#?\d+(?:\s*[-~至]\s*#?\d+)?\s*[）)]/g, " ")
    .replace(/[（(][^）)]{1,260}[）)]/g, "\n")
    .replace(/\b(Claude|Gabe|Reiko)#\d+\b/gi, "\n$1 ")
    .replace(/#\d+(?:\s*[-~至]\s*#?\d+)?/g, "\n")
    .replace(/([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])/g, "\n$1")
    .replace(/[；;]/g, "\n")
    .trim();

  const roughLines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const result: string[] = [];
  let currentHeading = "";
  let currentSpeaker = "";

  for (const raw of roughLines) {
    const isBullet = /^[-*•\d.、)）①-⑳\s]+/.test(raw);
    const line = raw.replace(/^[-*•\d.、)）①-⑳\s]+/, "").trim();
    if (!line) {
      continue;
    }

    const speakerMatch = line.match(SPEAKER_RE);
    if (speakerMatch) {
      currentSpeaker = normalizeSpeaker(speakerMatch[1]);
    }
    if (HEADING_RE.test(line) && line.length <= 16) {
      currentHeading = line;
      continue;
    }

    const quotes = Array.from(line.matchAll(/[“"]([^”"]{2,240})[”"]/g));
    if (quotes.length) {
      for (const match of quotes) {
        if (currentSpeaker) {
          result.push(`${currentSpeaker}说：${match[1]}`);
        } else {
          result.push(match[1]);
        }
      }
      continue;
    }

    if (NOISE_RE.test(line) && !MEMORY_SIGNAL_RE.test(line)) {
      continue;
    }
    const headingAllowsMemory = /偏好|设定|计划|关系|项目|事实|记忆|profile|summary/i.test(currentHeading);
    const isPersonalStatement = /^(用户|User|Reiko|Gabe|Claude|我们|本项目|该项目|角色卡|对话)/i.test(line);
    const isUsefulBullet = isBullet && line.length >= 8 && line.length <= 220;
    if (MEMORY_SIGNAL_RE.test(line) || headingAllowsMemory || isPersonalStatement || isUsefulBullet) {
      result.push(line);
    }
  }
  return result;
}

function normalizeMemoryLine(line: string): string {
  const cleaned = line
    .replace(/^[-*•\d.、)）①-⑳\s]+/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[：:,，\s]+|[：:,，\s]+$/g, "")
    .trim();
  if (!cleaned || cleaned.length < 8) {
    return "";
  }
  if (/^已完成/.test(cleaned)) {
    return "";
  }

  const spoken = cleaned.match(/^(Claude|Gabe|Reiko|用户|User)说[：:]\s*(.+)$/i);
  if (spoken) {
    return normalizeQuotedMemory(normalizeSpeaker(spoken[1]), spoken[2]);
  }

  const normalized = cleaned
    .replace(/^(用户|User)[：:]\s*/i, "Reiko ")
    .replace(/^(用户偏好|偏好)[：:]\s*/i, "Reiko偏好：")
    .replace(/^(项目计划|后续计划)[：:]\s*/i, "计划：")
    .replace(/^(关系状态|关系确认|关系)[：:]\s*/i, "关系：")
    .trim();

  if (TRANSIENT_RE.test(normalized) && !hasDurableOverride(normalized)) {
    return "";
  }
  if (!MEMORY_SIGNAL_RE.test(normalized) || normalized.length > 220) {
    return "";
  }
  return finishSentence(normalized);
}

function normalizeQuotedMemory(speaker: string, quote: string): string {
  const other = speaker === "Reiko" ? "Claude" : "Reiko";
  const rewritten = rewritePronouns(
    quote
      .replace(/^[：:,，\s]+|[：:,，\s]+$/g, "")
      .replace(/\s+/g, " ")
      .trim(),
    speaker,
    other
  );

  if (!rewritten || TRANSIENT_RE.test(rewritten) && !hasDurableOverride(rewritten)) {
    return "";
  }
  if (/(接受|能接受).{0,24}(不同意|不同意见)|(不同意|不同意见).{0,24}(接受|能接受)/.test(rewritten)) {
    return finishSentence(`${other}接受${speaker}保留不同意见，${speaker}因此更安心`);
  }
  if (/冷淡期/.test(rewritten) && /(拽回来|挽回|等|等待|修复|不放弃|不是说说)/.test(rewritten)) {
    return finishSentence(`${speaker}承诺在${other}进入冷淡期时等待并主动修复关系，而不是放弃`);
  }
  if (/(不换|没变)/.test(rewritten) && (/(关系|承诺|立场)/.test(rewritten) || rewritten.includes(`${speaker}的`))) {
    return finishSentence(`${speaker}确认对${other}的关系承诺没有改变`);
  }
  if (AMBIGUOUS_RE.test(rewritten)) {
    return "";
  }
  if (!hasStrongStableSignal(rewritten)) {
    return "";
  }
  return finishSentence(`${speaker}表示：${clampText(rewritten, 150)}`);
}

function rewritePronouns(text: string, speaker: string, other: string): string {
  return text
    .replace(/你/g, "\u0000OTHER\u0000")
    .replace(/我/g, speaker)
    .replace(/\u0000OTHER\u0000/g, other)
    .replace(new RegExp(`${speaker}说`, "g"), "")
    .trim();
}

function hasStrongStableSignal(text: string): boolean {
  return /(偏好|希望|要求|不喜欢|习惯|称呼|承诺|约定|接受|不同意|不同意见|不换|没变|冷淡期|挽回|修复|等待|不放弃|必须|不要|严格|固定|长期|以后|决定|确认|下一步|后续|计划|路径|目录|插件|工具包)/i.test(text);
}

function hasDurableOverride(text: string): boolean {
  return /(承诺|约定|接受.{0,24}(不同意|不同意见)|(不同意|不同意见).{0,24}接受|不换|没变|挽回|修复|不放弃|必须|不要|严格|固定|长期|以后|决定)/i.test(text);
}

function normalizeSpeaker(value: string): string {
  return /reiko|用户|user/i.test(value) ? "Reiko" : /gabe/i.test(value) ? "Gabe" : "Claude";
}

function finishSentence(text: string): string {
  const cleaned = text.replace(/[；;，,：:\s]+$/g, "").trim();
  return cleaned && !/[。！？!?]$/.test(cleaned) ? `${cleaned}。` : cleaned;
}

function inferType(line: string): BucketType {
  if (/计划|下一步|后续|待办|继续做/.test(line)) {
    return "plans";
  }
  if (/关系|亲密|陪伴|承诺|约定|冷淡期|挽回|修复|等待|安心|不换|没变/.test(line)) {
    return "feel";
  }
  if (/喜欢|不喜欢|偏好|希望|要求|习惯|称呼|设定|以后|固定|接受.*不同/.test(line)) {
    return "permanent";
  }
  return "dynamic";
}

function inferDomain(line: string, type: BucketType): string[] {
  if (/项目|路径|目录|仓库|代码|插件|工具包|测试|打包|UI|侧边栏/i.test(line)) {
    return ["project"];
  }
  if (type === "feel") {
    return ["relationship"];
  }
  if (type === "permanent") {
    return ["preference"];
  }
  if (type === "plans") {
    return ["project"];
  }
  return ["general"];
}

function inferTags(line: string, type: BucketType): string[] {
  const tags = ["summary-capture", type];
  if (/角色卡|character/i.test(line)) tags.push("character");
  if (/UI|侧边栏|工具箱|界面/i.test(line)) tags.push("ui");
  if (/Ombre|ombre/i.test(line)) tags.push("ombre");
  if (/Gabe|Claude|Reiko/i.test(line)) tags.push("relationship");
  if (/承诺|约定/.test(line)) tags.push("commitment");
  return Array.from(new Set(tags));
}

function inferImportance(line: string, type: BucketType): number {
  if (/必须|不要|严格|固定|长期|核心|以后|承诺|约定/.test(line)) {
    return 8;
  }
  if (type === "permanent" || type === "feel") {
    return 7;
  }
  return 6;
}

function titleFor(type: BucketType, summary: string): string {
  if (/冷淡期/.test(summary)) return "关系：冷淡期中的等待与修复";
  if (/不同意|不同意见/.test(summary)) return "关系：接受彼此保留不同意见";
  if (/关系承诺没有改变|不换|没变/.test(summary)) return "关系：关系承诺保持不变";
  if (/emoji/i.test(summary)) return "偏好：回复风格与 emoji";
  if (/Markdown buckets|本地 Markdown|本地记忆库/i.test(summary)) return "计划：摘要记忆写入本地库";

  const prefix = type === "plans" ? "计划" : type === "feel" ? "关系" : type === "permanent" ? "偏好" : "记忆";
  const topic = summary
    .replace(/^(Reiko|Claude|Gabe)(偏好|希望|要求|表示|确认|承诺)?[：:]?\s*/i, "")
    .replace(/[。！？!?].*$/, "")
    .trim();
  return clampText(`${prefix}：${topic}`, 42);
}
