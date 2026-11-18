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
export interface LlmRequest { system: string; messages: ChatMessage[]; temperature?: number; maxTokens?: number }

export class LlmError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

const env = (k: string) => (process.env[k] || "").trim();
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
        key: env("OPENCODE_API_KEY"),
        model: (s.modelName && s.modelName !== "local-model" ? s.modelName : "") || env("OPENCODE_MODEL") || "deepseek-v4-flash",
      };
    default:
      return {
        url: s.modelUrl || env("LOCAL_MODEL_URL") || "http://localhost:1234/v1",
        key: s.apiKey || env("LOCAL_MODEL_KEY"),
        model: s.modelName || env("LOCAL_MODEL_NAME") || "local-model",
      };
  }
};

async function openAiStream(t: OpenAiTarget, req: LlmRequest, onDelta: (d: string) => void, signal: AbortSignal): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(t.extraHeaders || {}) };
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
    return text;
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let acc = "";
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
      if (payload === "[DONE]") return acc;
      try {
        const ev = JSON.parse(payload);
        const delta = ev.choices?.[0]?.delta?.content || "";
        if (delta) { acc += delta; onDelta(delta); }
      } catch { /* keep-alive / мусор */ }
    }
  }
  return acc;
}

async function geminiStream(s: LlmSettings, req: LlmRequest, onDelta: (d: string) => void, signal: AbortSignal): Promise<string> {
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
  for await (const chunk of stream) {
    const t = chunk.text || "";
    if (t) { acc += t; onDelta(t); }
  }
  return acc;
}

/**
 * Единая точка вызова LLM. Возвращает полный текст; по ходу отдаёт куски в onDelta
 * (уже без мета-абзацев модели).
 */
export async function complete(settings: LlmSettings, reqIn: LlmRequest, onDelta?: (d: string) => void): Promise<string> {
  const req: LlmRequest = { ...reqIn, messages: normalizeMessages(reqIn.messages) };
  const provider = resolveProvider(settings);
  const filter = metaFilter(onDelta);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS());
  try {
    let text: string;
    if (provider === "mock") text = await mockComplete(req, d => filter.push(d));
    else if (provider === "gemini") text = await geminiStream(settings, req, d => filter.push(d), ctrl.signal);
    else text = await openAiStream(openAiTarget(provider, settings), req, d => filter.push(d), ctrl.signal);
    filter.flush();
    const clean = stripMetaPrefix(text);
    if (!clean.trim()) throw new LlmError("Модель вернула пустой ответ");
    return clean;
  } catch (e: any) {
    if (e?.name === "AbortError" || ctrl.signal.aborted) throw new LlmError(`Модель не ответила за ${Math.round(TIMEOUT_MS() / 1000)} с`, 504);
    if (e instanceof LlmError) throw e;
    const cause = e?.cause?.code || e?.cause?.message;
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
    : provider === "opencode" ? !!env("OPENCODE_API_KEY")
    : true;
  return { provider, forcedByEnv: !!env("LLM_PROVIDER"), keyPresent };
};
