import { GoogleGenAI } from "@google/genai";
import { mockComplete } from "./mock-llm";

export type Provider = "gemini" | "local" | "openrouter" | "opencode" | "mock";
export const PROVIDERS: Provider[] = ["gemini", "local", "openrouter", "opencode", "mock"];

export interface LlmSettings {
  provider: Provider;
  modelUrl?: string;
  apiKey?: string;
  modelName?: string;
  openRouterApiKey?: string;
  openRouterModel?: string;
}

export interface ChatMessage { role: "user" | "assistant"; content: string }
export interface LlmRequest {
  system: string; messages: ChatMessage[]; temperature?: number; maxTokens?: number;
  /** Стабильный id разговора (сессия игры + вид запроса): opencode Go требует его для маршрутизации и кэша промптов */
  conversationId?: string;
}

export interface LlmUsage { inputTokens: number; outputTokens: number; estimated: boolean }
export interface LlmResult { text: string; usage: LlmUsage; provider: Provider; model: string }

/** Грубая оценка токенов, если провайдер не вернул usage (кириллица ≈ 3 символа на токен). */
export const estimateTokens = (s: string) => Math.ceil((s || "").length / 3);

export class LlmError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

const env = (k: string) => (process.env[k] || "").trim();
const randomId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const TIMEOUT_MS = () => Number(process.env.LLM_TIMEOUT_MS || 180_000);

/** Срезает «мета»-абзацы, которые некоторые модели выдают перед ответом. */
const META_RE = /skill|brainstorm|AGENTS|creative writing|let me (check|think|just)|user (is asking|asks|wants|keeps)|according to|I.?ll answer|I will answer|this is (a|just|the)|Пользователь|навык|скилл|рассужд|отвечу как|я отвечу/i;

export const stripMetaPrefix = (text: string): string => {
  const out: string[] = [];
  let metaMode = true;
  for (const p of text.split(/\n\s*\n/)) {
    if (metaMode && p.length < 600 && META_RE.test(p) && !p.includes("<")) continue;
    metaMode = false;
    out.push(p);
  }
  return out.join("\n\n").trim();
};

/** Буферизует первый абзац стрима, чтобы не показать игрокам мета-текст модели. */
const metaFilter = (onDelta?: (d: string) => void) => {
  let pending = "";
  let passthrough = false;
  return {
    push(delta: string) {
      if (!onDelta) return;
      if (passthrough) { onDelta(delta); return; }
      pending += delta;
      const boundary = pending.indexOf("\n\n");
      if (boundary >= 0 || pending.length > 800) {
        passthrough = true;
        const trailing = pending.match(/\s*$/)?.[0] || "";
        const head = stripMetaPrefix(pending);
        if (head) onDelta(head + trailing);
        pending = "";
      }
    },
    flush() {
      if (onDelta && !passthrough && pending) onDelta(stripMetaPrefix(pending));
    },
  };
};

/** Склеивает подряд идущие реплики одной роли и гарантирует, что диалог начинается с user. */
export const normalizeMessages = (messages: ChatMessage[]): ChatMessage[] => {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (!m.content?.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.content;
    else out.push({ role: m.role, content: m.content });
  }
  if (out.length === 0 || out[0].role !== "user") out.unshift({ role: "user", content: "(Продолжаем историю.)" });
  return out;
};

export const resolveProvider = (s: LlmSettings): Provider => {
  const forced = env("LLM_PROVIDER") as Provider;
  if (forced && PROVIDERS.includes(forced)) return forced;
  return PROVIDERS.includes(s.provider) ? s.provider : "gemini";
};

interface OpenAiTarget { url: string; key: string; model: string; extraHeaders?: Record<string, string> }

const openAiTarget = (provider: Provider, s: LlmSettings): OpenAiTarget => {
  switch (provider) {
    case "openrouter":
      return {
        url: "https://openrouter.ai/api/v1",
        key: s.openRouterApiKey || env("OPENROUTER_API_KEY"),
        model: s.openRouterModel || env("OPENROUTER_MODEL") || "anthropic/claude-3.5-sonnet",
        extraHeaders: { "HTTP-Referer": env("APP_URL") || "http://localhost", "X-Title": "Nexus RPG" },
      };
    case "opencode":
      return {
        url: env("OPENCODE_API_URL") || "https://opencode.ai/zen/go/v1",
        key: s.apiKey || env("OPENCODE_API_KEY"),
        model: (s.modelName && s.modelName !== "local-model" ? s.modelName : "") || env("OPENCODE_MODEL") || "deepseek-v4.1-flash",
        // opencode Go: свой user agent и стабильный x-opencode-session на разговор (иначе HTTP 400 MissingSessionID)
        extraHeaders: { "User-Agent": "nexus-rpg/1.0", "x-opencode-session": "" },
      };
    default:
      return {
        url: s.modelUrl || env("LOCAL_MODEL_URL") || "http://localhost:1234/v1",
        key: s.apiKey || env("LOCAL_MODEL_KEY"),
        model: s.modelName || env("LOCAL_MODEL_NAME") || "local-model",
      };
  }
};

async function openAiStream(t: OpenAiTarget, req: LlmRequest, onDelta: (d: string) => void, signal: AbortSignal, wantUsage: boolean): Promise<{ text: string; usage?: LlmUsage }> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(t.extraHeaders || {}) };
  if ("x-opencode-session" in headers) headers["x-opencode-session"] = req.conversationId || randomId();
  // браузер (демо) не даёт задавать User-Agent — не мешаем ему
  if (typeof window !== "undefined") delete headers["User-Agent"];
  if (t.key && t.key !== "not-needed") headers.Authorization = `Bearer ${t.key}`;
  const res = await fetch(`${t.url.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      model: t.model,
      messages: [{ role: "system", content: req.system }, ...normalizeMessages(req.messages)],
      temperature: req.temperature ?? 0.7,
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      stream: true,
      ...(wantUsage ? { stream_options: { include_usage: true } } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new LlmError(`Провайдер ответил HTTP ${res.status}: ${body.slice(0, 300)}`, res.status === 401 || res.status === 403 ? 502 : 502);
  }
  const ctype = res.headers.get("content-type") || "";
  if (!ctype.includes("event-stream")) {
    // Сервер проигнорировал stream=true
    const data: any = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    onDelta(text);
    const u = data.usage;
    return { text, usage: u ? { inputTokens: u.prompt_tokens || 0, outputTokens: u.completion_tokens || 0, estimated: false } : undefined };
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let acc = "";
  let usage: LlmUsage | undefined;
  let reasoningChars = 0;
  const finish = () => {
    if (!acc.trim() && reasoningChars > 0) {
      throw new LlmError("Модель весь лимит потратила на рассуждения и не успела ответить. Увеличьте лимит ответа или выберите модель без рассуждений (например, flash-версию).");
    }
    return { text: acc, usage };
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return finish();
      try {
        const ev = JSON.parse(payload);
        const delta = ev.choices?.[0]?.delta?.content || "";
        if (delta) { acc += delta; onDelta(delta); }
        // модели с рассуждениями (DeepSeek, Kimi…) шлют «мысли» отдельно — не показываем, но учитываем
        const thought = ev.choices?.[0]?.delta?.reasoning_content || ev.choices?.[0]?.delta?.reasoning || "";
        if (thought) reasoningChars += thought.length;
        if (ev.choices?.[0]?.finish_reason === "length") console.warn(`[llm] ответ обрезан по лимиту токенов (${acc.length} символов текста, ${reasoningChars} рассуждений)`);
        if (ev.usage) usage = { inputTokens: ev.usage.prompt_tokens || 0, outputTokens: ev.usage.completion_tokens || 0, estimated: false };
      } catch { /* keep-alive / мусор */ }
    }
  }
  console.warn(`[llm] поток закрыт без [DONE] (${acc.length} симв.)`);
  return finish();
}

/** Gemini через REST (SSE) — без SDK: работает и в Node, и прямо в браузере (демо). */
async function geminiRestStream(s: LlmSettings, req: LlmRequest, onDelta: (d: string) => void, signal: AbortSignal): Promise<{ text: string; usage?: LlmUsage }> {
  const apiKey = s.apiKey || env("GEMINI_API_KEY");
  if (!apiKey) throw new LlmError("Не задан ключ Gemini", 500);
  const model = s.modelName && s.modelName !== "local-model" ? s.modelName : env("GEMINI_MODEL") || "gemini-3-flash-preview";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: normalizeMessages(req.messages).map(m => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] })),
      generationConfig: { temperature: req.temperature ?? 0.7, ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}) },
    }),
  });
  if (!res.ok) throw new LlmError(`Gemini ответил HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "", acc = "";
  let usage: LlmUsage | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      try {
        const ev = JSON.parse(line.slice(5).trim());
        const t = (ev.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
        if (t) { acc += t; onDelta(t); }
        const um = ev.usageMetadata;
        if (um) usage = { inputTokens: um.promptTokenCount || 0, outputTokens: um.candidatesTokenCount || 0, estimated: false };
      } catch { /* неполная строка */ }
    }
  }
  return { text: acc, usage };
}

async function geminiStream(s: LlmSettings, req: LlmRequest, onDelta: (d: string) => void, signal: AbortSignal): Promise<{ text: string; usage?: LlmUsage }> {
  const apiKey = s.apiKey || env("GEMINI_API_KEY");
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") throw new LlmError("GEMINI_API_KEY не настроен на сервере", 500);
  const ai = new GoogleGenAI({ apiKey });
  const model = s.modelName && s.modelName !== "local-model" ? s.modelName : env("GEMINI_MODEL") || "gemini-3-flash-preview";
  const contents = normalizeMessages(req.messages).map(m => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] }));
  const stream = await ai.models.generateContentStream({
    model,
    contents,
    config: { systemInstruction: req.system, temperature: req.temperature ?? 0.7, abortSignal: signal, ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}) },
  });
  let acc = "";
  let usage: LlmUsage | undefined;
  for await (const chunk of stream) {
    const t = chunk.text || "";
    if (t) { acc += t; onDelta(t); }
    const um = (chunk as any).usageMetadata;
    if (um) usage = { inputTokens: um.promptTokenCount || 0, outputTokens: um.candidatesTokenCount || 0, estimated: false };
  }
  return { text: acc, usage };
}

/**
 * Единая точка вызова LLM. Возвращает полный текст; по ходу отдаёт куски в onDelta
 * (уже без мета-абзацев модели).
 */
export async function complete(settings: LlmSettings, reqIn: LlmRequest, onDelta?: (d: string) => void): Promise<string> {
  return (await completeWithUsage(settings, reqIn, onDelta)).text;
}

export const modelNameFor = (s: LlmSettings): string => {
  const p = resolveProvider(s);
  if (p === "mock") return "mock";
  if (p === "gemini") return s.modelName && s.modelName !== "local-model" ? s.modelName : env("GEMINI_MODEL") || "gemini-3-flash-preview";
  return openAiTarget(p, s).model;
};

export async function completeWithUsage(settings: LlmSettings, reqIn: LlmRequest, onDelta?: (d: string) => void): Promise<LlmResult> {
  const req: LlmRequest = { ...reqIn, messages: normalizeMessages(reqIn.messages) };
  const provider = resolveProvider(settings);
  const filter = metaFilter(onDelta);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS());
  try {
    let r: { text: string; usage?: LlmUsage };
    const needsKey = provider === "openrouter" ? !(settings.openRouterApiKey || env("OPENROUTER_API_KEY"))
      : provider === "opencode" ? !(settings.apiKey || env("OPENCODE_API_KEY"))
      : provider === "gemini" ? !(settings.apiKey || env("GEMINI_API_KEY")) : false;
    if (needsKey) throw new LlmError(env("NODE_ENV") === "demo"
      ? "Ключ ИИ не сохранён на этом устройстве. Откройте «Пространство → ИИ» и введите ключ заново (или включите «Запомнить на этом устройстве»)."
      : `Не задан API-ключ для ${provider}. Укажите ключ в настройках пространства или платформы.`, 400);
    if (provider === "mock") r = { text: await mockComplete(req, d => filter.push(d)) };
    else if (provider === "gemini") r = await (env("GEMINI_REST") === "1" ? geminiRestStream : geminiStream)(settings, req, d => filter.push(d), ctrl.signal);
    else r = await openAiStream(openAiTarget(provider, settings), req, d => filter.push(d), ctrl.signal, provider !== "local");
    filter.flush();
    const clean = stripMetaPrefix(r.text);
    if (!clean.trim()) throw new LlmError("Модель вернула пустой ответ");
    const usage = r.usage && (r.usage.inputTokens || r.usage.outputTokens) ? r.usage : {
      inputTokens: estimateTokens(req.system) + req.messages.reduce((a, m) => a + estimateTokens(m.content), 0),
      outputTokens: estimateTokens(r.text),
      estimated: true,
    };
    return { text: clean, usage, provider, model: modelNameFor(settings) };
  } catch (e: any) {
    if (e?.name === "AbortError" || ctrl.signal.aborted) throw new LlmError(`Модель не ответила за ${Math.round(TIMEOUT_MS() / 1000)} с`, 504);
    if (e instanceof LlmError) throw e;
    const cause = e?.cause?.code || e?.cause?.message;
    // В браузере (демо) сетевой отказ почти всегда означает, что провайдер не принимает запросы со сторонних сайтов (CORS)
    if (env("NODE_ENV") === "demo" && /Failed to fetch|NetworkError|Load failed/i.test(String(e?.message))) {
      throw new LlmError(`Браузер не смог обратиться к ${provider}: провайдер не принимает запросы со сторонних сайтов или сеть недоступна. В демо работают OpenRouter и Gemini; opencode — только на своём сервере игры.`);
    }
    throw new LlmError(`Ошибка ИИ-провайдера (${provider}): ${e?.message || e}${cause ? ` [${cause}]` : ""}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Описание текущего провайдера для UI (без секретов). */
export const describeProvider = (s: LlmSettings) => {
  const provider = resolveProvider(s);
  const keyPresent =
    provider === "mock" ? true
    : provider === "gemini" ? !!(s.apiKey || env("GEMINI_API_KEY"))
    : provider === "openrouter" ? !!(s.openRouterApiKey || env("OPENROUTER_API_KEY"))
    : provider === "opencode" ? !!(s.apiKey || env("OPENCODE_API_KEY"))
    : true;
  return { provider, forcedByEnv: !!env("LLM_PROVIDER"), keyPresent };
};
