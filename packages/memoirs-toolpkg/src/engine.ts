import { loadMemoryBuckets } from "./memorySource";
import { loadData, saveData } from "./store";
import { addReadingContext, cancelInvitationContexts } from "./chatSync";
import type {
  Annotation,
  DailyBook,
  EventState,
  MemoirScope,
  MemoirsData,
  MemoryBucket,
  ReadingHistoryEntry,
  ReadingSession,
} from "./types";

export interface ActiveChat {
  chatId: string;
  title: string;
  characterId?: string;
  characterName?: string;
}

export interface MemoirsSnapshot {
  date: string;
  chat: ActiveChat | null;
  book: DailyBook | null;
  event: EventState;
  revealed: Array<{ page: number; selectedBy: string[]; memory: MemoryBucket; annotations: Annotation[] }>;
  sourceCount: number;
  sourceErrors: number;
  sourceRoots: string[];
  settings: MemoirsData["settings"];
  roleName: string;
  availableChats: ActiveChat[];
  readingLog: Array<{
    id: string;
    date: string;
    readAt: string;
    userPage: number;
    assistantPage: number;
    items: Array<{ page: number; selectedBy: string[]; memory: MemoryBucket; annotations: Annotation[] }>;
  }>;
  chatSync: {
    pending: number;
    inFlight: number;
    consumed: number;
    latestReadingStatus?: "pending" | "in_flight" | "consumed" | "cancelled";
  };
  workflow: MemoirsData["workflow"];
}

export function localDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function getChatContext(settings: MemoirsData["settings"]): Promise<{ chat: ActiveChat | null; availableChats: ActiveChat[] }> {
  const result = await Tools.Chat.listAll();
  const availableChats: ActiveChat[] = (Array.isArray(result?.chats) ? result.chats : []).map((item: any) => ({
    chatId: String(item?.id || ""),
    title: String(item?.title || "未命名聊天"),
    characterId: textOrUndefined(item?.characterCardId),
    characterName: textOrUndefined(item?.characterCardName),
  })).filter((item: ActiveChat) => Boolean(item.chatId));
  const currentChatId = String(result?.currentChatId || "").trim();
  const wantedId = settings.chatBinding === "fixed" && settings.fixedChatId
    ? settings.fixedChatId
    : currentChatId;
  return { chat: availableChats.find((item) => item.chatId === wantedId) || null, availableChats };
}

export async function getSnapshot(createBook = false): Promise<MemoirsSnapshot> {
  const date = localDate();
  const data = await loadData();
  const { chat, availableChats } = await getChatContext(data.settings);
  const event = data.eventStates[date] || emptyEvent(date, chat?.chatId);
  let book = data.dailyBooks[date] || null;
  let loaded: Awaited<ReturnType<typeof loadMemoryBuckets>> | null = null;
  if (createBook && !book) {
    loaded = await loadMemoryBuckets();
    book = buildBook(date, loaded.buckets, data, chatScope(chat));
    data.dailyBooks[date] = book;
    data.eventStates[date] = { ...event, status: event.status === "not_triggered" ? "accepted" : event.status, updatedAt: new Date().toISOString() };
    await saveData(data);
  }
  if (!loaded) loaded = await loadMemoryBuckets();
  const byId = new Map(loaded.buckets.map((bucket) => [bucket.id, bucket]));
  return {
    date,
    chat,
    book,
    event: data.eventStates[date] || event,
    revealed: revealedPages(book, data.eventStates[date] || event, byId, data),
    sourceCount: loaded.buckets.length,
    sourceErrors: loaded.errors.length,
    sourceRoots: loaded.roots,
    settings: data.settings,
    roleName: chat?.characterName || data.activity[chat?.chatId || ""]?.roleName || "当前角色",
    availableChats,
    readingLog: buildReadingLog(data, byId, chat?.characterName || "当前角色"),
    chatSync: {
      pending: data.chatContexts.filter((item) => item.status === "pending").length,
      inFlight: data.chatContexts.filter((item) => item.status === "in_flight").length,
      consumed: data.chatContexts.filter((item) => item.status === "consumed").length,
      latestReadingStatus: data.chatContexts.slice().reverse().find((item) => item.kind === "reading")?.status,
    },
    workflow: data.workflow,
  };
}

export async function acceptToday(): Promise<MemoirsSnapshot> {
  const data = await loadData();
  const date = localDate();
  const { chat } = await getChatContext(data.settings);
  const previous = data.eventStates[date] || emptyEvent(date, chat?.chatId);
  data.eventStates[date] = { ...previous, chatId: chat?.chatId, status: "accepted", updatedAt: new Date().toISOString() };
  cancelInvitationContexts(data, date);
  await saveData(data);
  return getSnapshot(true);
}

export async function skipToday(): Promise<MemoirsSnapshot> {
  const data = await loadData();
  const date = localDate();
  const { chat } = await getChatContext(data.settings);
  data.eventStates[date] = { date, chatId: chat?.chatId, status: "skipped", updatedAt: new Date().toISOString() };
  cancelInvitationContexts(data, date);
  await saveData(data);
  return getSnapshot(false);
}

export async function chooseUserPage(page: number): Promise<MemoirsSnapshot> {
  const data = await loadData();
  const date = localDate();
  const book = data.dailyBooks[date];
  validatePage(book, page);
  const event = data.eventStates[date] || emptyEvent(date);
  event.userPage = page;
  event.status = "accepted";
  event.updatedAt = new Date().toISOString();
  data.eventStates[date] = event;
  await completeIfReady(data, book, event);
  await saveData(data);
  return getSnapshot(false);
}

export async function askCurrentRoleToChoose(): Promise<MemoirsSnapshot> {
  const data = await loadData();
  const date = localDate();
  const book = data.dailyBooks[date];
  if (!book || !book.pages.length) throw new Error("今天的书册尚未生成");
  const { chat } = await getChatContext(data.settings);
  if (!chat) throw new Error("没有可用的当前聊天");
  const prompt = [
    "这是《记忆之书》的一次盲选。",
    `今天的书共有 ${book.pages.length} 页。`,
    `请在 1 到 ${book.pages.length} 之间选一个页码。你不知道任何页对应什么内容，也不要分析或询问页面内容。`,
    '只回复严格 JSON：{"page":数字}',
  ].join("\n");
  const response = await Tools.Chat.sendMessage(prompt, chat.chatId, chat.characterId, undefined, {
    persist_turn: false,
    notify_reply: false,
    hide_user_message: true,
    disable_warning: true,
    timeout_ms: 120000,
  });
  const page = parsePage(String(response?.aiResponse || response?.message || ""), book.pages.length);
  if (!page) throw new Error("当前角色没有返回有效页码，可以再试一次");
  const event = data.eventStates[date] || emptyEvent(date, chat.chatId);
  event.assistantPage = page;
  event.status = "accepted";
  event.updatedAt = new Date().toISOString();
  data.eventStates[date] = event;
  await completeIfReady(data, book, event);
  await saveData(data);
  return getSnapshot(false);
}

export async function addUserAnnotation(memoryId: string, content: string): Promise<MemoirsSnapshot> {
  const text = normalizeAnnotation(content);
  if (!text) throw new Error("批注不能为空");
  const data = await loadData();
  appendAnnotation(data, memoryId, "user", "Reiko", text);
  await saveData(data);
  return getSnapshot(false);
}

export async function askCurrentRoleToAnnotate(memoryId: string): Promise<MemoirsSnapshot> {
  const data = await loadData();
  const date = localDate();
  const book = data.dailyBooks[date];
  const page = book ? book.pages.indexOf(memoryId) + 1 : 0;
  const loaded = await loadMemoryBuckets();
  const memory = loaded.buckets.find((item) => item.id === memoryId);
  const { chat } = await getChatContext(data.settings);
  if (!memory || !chat || page < 1) throw new Error("无法定位这页记忆或当前聊天");
  const prompt = [
    `我们刚翻开《记忆之书》的第 ${page} 页。`,
    "下面是已经揭开的旧记忆：",
    memory.body,
    "你可以留一句很短的当下批注，也可以选择不写。不要提出后续话题，不要引导对话。",
    '只回复严格 JSON：{"annotation":"一句批注"}；不写则回复 {"annotation":""}',
  ].join("\n\n");
  const response = await Tools.Chat.sendMessage(prompt, chat.chatId, chat.characterId, undefined, {
    persist_turn: false,
    notify_reply: false,
    hide_user_message: true,
    disable_warning: true,
    timeout_ms: 120000,
  });
  const annotation = parseAnnotation(String(response?.aiResponse || response?.message || ""));
  if (annotation) appendAnnotation(data, memoryId, "assistant", chat.characterName || "当前角色", annotation);
  await saveData(data);
  return getSnapshot(false);
}

export async function updateSettings(input: Partial<MemoirsData["settings"]>): Promise<MemoirsSnapshot> {
  const data = await loadData();
  data.settings = {
    maxPages: bounded(input.maxPages, 2, 500, data.settings.maxPages),
    cooldownDays: bounded(input.cooldownDays, 0, 365, data.settings.cooldownDays),
    minBodyChars: bounded(input.minBodyChars, 0, 1000, data.settings.minBodyChars),
    excludeResolved: input.excludeResolved !== false,
    excludeDigested: input.excludeDigested === true,
    chatBinding: input.chatBinding === "fixed" ? "fixed" : "current",
    fixedChatId: String(input.fixedChatId || "").trim(),
    autoInvitationEnabled: input.autoInvitationEnabled == null
      ? data.settings.autoInvitationEnabled
      : input.autoInvitationEnabled === true,
    invitationIdleMinutes: bounded(input.invitationIdleMinutes, 15, 1440, data.settings.invitationIdleMinutes),
  };
  await saveData(data);
  return getSnapshot(false);
}

export async function returnToBoundChat(): Promise<MemoirsSnapshot> {
  const data = await loadData();
  if (data.settings.chatBinding !== "fixed" || !data.settings.fixedChatId) {
    throw new Error("请先绑定一个固定聊天窗口");
  }
  await Tools.Chat.switchTo(data.settings.fixedChatId);
  return getSnapshot(false);
}

export async function recordMessageActivity(event: ToolPkg.ChatMessageHookEvent): Promise<void> {
  const payload = event?.eventPayload || {};
  const chatId = String(payload.chatId || "").trim();
  if (!chatId) return;
  const data = await loadData();
  const item = data.activity[chatId] || {};
  const sender = String(payload.sender || "").toLowerCase();
  const timestamp = Number(payload.timestamp || payload.completedAt || Date.now());
  if (sender.includes("user")) item.lastUserAt = timestamp;
  else {
    item.lastAssistantAt = timestamp;
    if (payload.roleName) item.roleName = String(payload.roleName);
  }
  data.activity[chatId] = item;
  await saveData(data);
}

function buildBook(date: string, buckets: MemoryBucket[], data: MemoirsData, scope: MemoirScope): DailyBook {
  const uniqueBodies = new Set<string>();
  const candidates = buckets.filter((bucket) => {
    if (bucket.type === "archive" || bucket.body.trim().length < data.settings.minBodyChars) return false;
    if (data.settings.excludeResolved && bucket.resolved) return false;
    if (data.settings.excludeDigested && bucket.digested) return false;
    if (!scopeMatches(bucket, scope)) return false;
    const fingerprint = bucket.body.replace(/\s+/g, " ").trim().toLocaleLowerCase();
    if (uniqueBodies.has(fingerprint)) return false;
    uniqueBodies.add(fingerprint);
    return true;
  });
  const cooldownMs = data.settings.cooldownDays * 86400000;
  const cutoff = Date.now() - cooldownMs;
  const fresh = candidates.filter((bucket) => {
    const lastRead = Date.parse(data.readingHistory[bucket.id]?.lastReadAt || "");
    return !Number.isFinite(lastRead) || lastRead < cutoff;
  });
  const pool = fresh.length >= 2 ? fresh : candidates;
  const shuffled = seededShuffle(pool, `${date}|${scope.chatId || ""}|${scope.characterId || ""}`);
  return {
    id: `memoirs_${date}`,
    date,
    createdAt: new Date().toISOString(),
    scope,
    pages: shuffled.slice(0, data.settings.maxPages).map((bucket) => bucket.id),
    sourceCount: candidates.length,
  };
}

function scopeMatches(bucket: MemoryBucket, scope: MemoirScope): boolean {
  if (bucket.chatId && bucket.chatId !== scope.chatId) return false;
  if (bucket.characterId && bucket.characterId !== scope.characterId) return false;
  if (bucket.projectId && bucket.projectId !== scope.projectId) return false;
  return true;
}

async function completeIfReady(data: MemoirsData, book: DailyBook, event: EventState): Promise<void> {
  if (!event.userPage || !event.assistantPage || event.status === "completed") return;
  const selections = [
    { page: event.userPage, who: "user" as const },
    { page: event.assistantPage, who: "assistant" as const },
  ];
  const unique = new Map<string, { user: number; assistant: number }>();
  for (const selection of selections) {
    const id = book.pages[selection.page - 1];
    const counts = unique.get(id) || { user: 0, assistant: 0 };
    counts[selection.who] += 1;
    unique.set(id, counts);
  }
  const now = new Date().toISOString();
  for (const [memoryId, counts] of unique) {
    const previous: ReadingHistoryEntry = data.readingHistory[memoryId] || {
      memoryId, lastReadAt: now, readCount: 0, selectedByUser: 0, selectedByAssistant: 0,
    };
    data.readingHistory[memoryId] = {
      ...previous,
      lastReadAt: now,
      readCount: previous.readCount + 1,
      selectedByUser: previous.selectedByUser + counts.user,
      selectedByAssistant: previous.selectedByAssistant + counts.assistant,
    };
  }
  const sessionId = `reading_${now.replace(/[^0-9]/g, "")}`;
  const session: ReadingSession = {
    id: sessionId,
    date: book.date,
    readAt: now,
    userPage: event.userPage,
    assistantPage: event.assistantPage,
    items: Array.from(new Set([event.userPage, event.assistantPage])).map((page) => ({
      memoryId: book.pages[page - 1],
      page,
      selectedBy: [
        ...(event.userPage === page ? ["user" as const] : []),
        ...(event.assistantPage === page ? ["assistant" as const] : []),
      ],
    })),
  };
  data.readingSessions.push(session);
  addReadingContext(data, session, book.scope.chatId);
  event.status = "completed";
  event.updatedAt = now;
}

function revealedPages(book: DailyBook | null, event: EventState, byId: Map<string, MemoryBucket>, data: MemoirsData): MemoirsSnapshot["revealed"] {
  if (!book || event.status !== "completed") return [];
  const pages = [event.userPage, event.assistantPage].filter((value): value is number => Boolean(value));
  const unique = Array.from(new Set(pages));
  return unique.map((page) => {
    const memoryId = book.pages[page - 1];
    const memory = byId.get(memoryId);
    if (!memory) return null;
    const selectedBy: string[] = [];
    if (event.userPage === page) selectedBy.push("Reiko");
    if (event.assistantPage === page) selectedBy.push("assistant");
    return { page, selectedBy, memory, annotations: data.annotations[memoryId] || [] };
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function appendAnnotation(data: MemoirsData, memoryId: string, author: "user" | "assistant", authorName: string, content: string): void {
  const list = data.annotations[memoryId] || [];
  const now = new Date();
  const session = data.readingSessions.slice().reverse().find((item) => item.items.some((entry) => entry.memoryId === memoryId));
  list.push({
    id: `note_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
    memoryId,
    author,
    authorName,
    date: localDate(now),
    content: normalizeAnnotation(content),
    sessionId: session?.id,
  });
  data.annotations[memoryId] = list;
}

function buildReadingLog(
  data: MemoirsData,
  byId: Map<string, MemoryBucket>,
  roleName: string
): MemoirsSnapshot["readingLog"] {
  return data.readingSessions.slice().reverse().map((session) => ({
    id: session.id,
    date: session.date,
    readAt: session.readAt,
    userPage: session.userPage,
    assistantPage: session.assistantPage,
    items: session.items.map((item) => {
      const memory = byId.get(item.memoryId);
      if (!memory) return null;
      const annotations = (data.annotations[item.memoryId] || []).filter((note) =>
        note.sessionId ? note.sessionId === session.id : note.date === session.date
      );
      return {
        page: item.page,
        selectedBy: item.selectedBy.map((author) => author === "user" ? "Reiko" : roleName),
        memory,
        annotations,
      };
    }).filter((item): item is NonNullable<typeof item> => Boolean(item)),
  }));
}

function parsePage(response: string, max: number): number | null {
  const json = response.match(/\{[\s\S]*?"page"\s*:\s*(\d+)[\s\S]*?\}/i);
  const fallback = response.match(/\b(\d+)\b/);
  const value = Number(json?.[1] || fallback?.[1] || 0);
  return Number.isInteger(value) && value >= 1 && value <= max ? value : null;
}

function parseAnnotation(response: string): string {
  try {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) return normalizeAnnotation(JSON.parse(match[0]).annotation);
  } catch (_error) {
  }
  return "";
}

function normalizeAnnotation(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 160);
}

function validatePage(book: DailyBook | undefined, page: number): void {
  if (!book) throw new Error("今天的书册尚未生成");
  if (!Number.isInteger(page) || page < 1 || page > book.pages.length) throw new Error(`页码应在 1–${book.pages.length} 之间`);
}

function emptyEvent(date: string, chatId?: string): EventState {
  return { date, chatId, status: "not_triggered", updatedAt: new Date().toISOString() };
}

function chatScope(chat: ActiveChat | null): MemoirScope {
  return { chatId: chat?.chatId, characterId: chat?.characterId };
}

function textOrUndefined(value: unknown): string | undefined {
  const text = String(value || "").trim();
  return text || undefined;
}

function bounded(value: number | undefined, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value as number))) : fallback;
}

function seededShuffle<T>(items: T[], seedText: string): T[] {
  let seed = 2166136261;
  for (let index = 0; index < seedText.length; index += 1) {
    seed ^= seedText.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  const result = items.slice();
  function random(): number {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}
