import type { ModelEntry } from './store.js';
import { logCall } from '../billing/tracker.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCallRef[]; // assistant 消息携带的工具调用（回传时用）
  tool_call_id?: string;       // role:tool 时关联的 id
}

export interface ToolCallRef {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON 字符串
}

export interface CallResult {
  content: string;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
  model: ModelEntry;
}

export interface CallOpts {
  temperature?: number;
  maxTokens?: number;
  sessionId?: string;
  mode?: string;
  jsonMode?: boolean;
  tools?: ToolDef[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  /** DeepSeek 思考模式开关：'disabled' 关闭思考（下棋加速，避免 max_tokens 被思考耗尽截断）。仅 deepseek 域名生效。 */
  thinking?: 'enabled' | 'disabled';
  /** 外部中止信号（流式调用时用于中途停止） */
  signal?: AbortSignal;
}

/** 流式事件：content=文本增量；tool_call_args=工具调用参数增量；done=结束汇总 */
export type StreamEvent =
  | { kind: 'content'; text: string }
  | { kind: 'tool_call_args'; index: number; name?: string; argsDelta: string }
  | { kind: 'done'; content: string; toolCalls: ToolCall[]; inputTokens: number; outputTokens: number; finishReason: string };

/** 粗略 token 估算（流式无 usage 时兜底）：中文按 1 token/字，ASCII 按 4 字符/token */
function estimateTokens(text: string): number {
  let cjk = 0;
  let ascii = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) cjk++;
    else ascii++;
  }
  return Math.ceil(cjk + ascii / 4);
}

/**
 * 计算实际请求端点。
 * DeepSeek 的 strict 模式需走 Beta base_url（https://api-docs.deepseek.com/zh-cn/guides/tool_calls）。
 * 当 tools 中存在 strict:true 的工具且 base_url 指向 deepseek 时，自动切到 /beta 路径；
 * 其他厂商（OpenAI 兼容）直接走标准路径即可。
 */
function buildEndpointUrl(base_url: string, tools?: ToolDef[]): string {
  const base = base_url.replace(/\/$/, '');
  const hasStrict = tools?.some((t) => t.function.strict === true) ?? false;
  const isDeepSeek = /:\/\/(api\.)?deepseek\.com/.test(base);
  const alreadyBeta = /\/beta$/.test(base);
  if (hasStrict && isDeepSeek && !alreadyBeta) {
    return `${base}/beta/chat/completions`;
  }
  return `${base}/chat/completions`;
}

/**
 * 构建请求体（stream 标志由调用方决定）。
 */
function buildBody(model: ModelEntry, messages: ChatMessage[], opts: CallOpts, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: model.model_name,
    messages,
  };
  // 只在显式指定时传 temperature；未指定则让各模型用自己的默认值
  // （部分模型如 kimi-k2.5 只允许 temperature=1，传 0.7 会被拒）
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.jsonMode && !opts.tools) body.response_format = { type: 'json_object' };
  if (opts.tools && opts.tools.length) {
    body.tools = opts.tools;
    if (opts.toolChoice) body.tool_choice = opts.toolChoice;
  }
  if (stream) body.stream = true;
  // 关闭 DeepSeek 思考模式：下棋无需思维链，避免 max_tokens 被思考耗尽致 length 截断；
  // 仅 deepseek 域名传 thinking 字段，其他厂商忽略未知字段更安全。
  if (opts.thinking && /:\/\/(api\.)?deepseek\.com/.test(model.base_url)) {
    body.thinking = { type: opts.thinking };
  }
  return body;
}

/** 读取 AI_TIMEOUT_MS（默认 90s），钳制到 5s~300s，非法值回退 90s */
function resolveTimeoutMs(): number {
  const raw = Number(process.env.AI_TIMEOUT_MS ?? 90000);
  return Number.isFinite(raw) ? Math.min(Math.max(raw, 5000), 300000) : 90000;
}

/* =====================================================
   Per-model 串行队列
   部分厂商账号限制并发数（如 Kimi "max organization concurrency: 1"），
   观战 AI / 下棋 AI / Chat 可能同时命中同一模型 → 429。
   用互斥锁保证：同一 model.id 的请求（含流式整个生命周期）永不并发。
===================================================== */
const modelLocks = new Map<string, Promise<void>>();

/** 获取模型锁：同一 model.id 同时只有一个持有者；返回 release 函数 */
function acquireModelLock(modelId: string): Promise<() => void> {
  const prev = modelLocks.get(modelId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  modelLocks.set(modelId, prev.then(() => gate));
  return prev.then(() => release);
}

/** 429 限流错误：附带服务器建议的等待时间（Retry-After 头，单位秒） */
export interface ModelError extends Error {
  status?: number;
  retryAfterMs?: number;
}

/** 公共 HTTP 请求：超时控制 + 非 2xx 错误统一抛出（带 status / retryAfterMs） */
async function requestCompletion(
  url: string,
  body: Record<string, unknown>,
  apiKey: string,
  modelName: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  // 外部 signal 触发时同样中止
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    // 超时/外部中断：给出可读错误（调用方据此走 correction / 降级链 / 流式回退）
    if ((err as Error).name === 'AbortError') {
      throw new Error(signal?.aborted ? '请求被中止' : `模型调用超时（${timeoutMs}ms）: ${modelName}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    const err = new Error(`模型调用失败 ${resp.status}: ${txt.slice(0, 400)}`) as ModelError;
    err.status = resp.status;
    // 429：读取 Retry-After（秒），供调用方精确退避，避免盲等
    if (resp.status === 429) {
      const ra = Number(resp.headers.get('retry-after'));
      if (Number.isFinite(ra) && ra > 0) err.retryAfterMs = ra * 1000;
    }
    throw err;
  }
  return resp;
}

/**
 * OpenAI 兼容调用：POST {base_url}/chat/completions
 * 兼容 DeepSeek / 通义 / Moonshot / OpenAI / 本地 Ollama 等。
 * 支持 tools / tool_calls（结构化动作编码），亦兼容纯文本 JSON。
 * 同一模型并发调用会被 per-model 锁串行化（规避厂商账号并发上限）。
 */
export async function callModel(model: ModelEntry, messages: ChatMessage[], opts: CallOpts = {}): Promise<CallResult> {
  const release = await acquireModelLock(model.id);
  try {
    return await callModelUnlocked(model, messages, opts);
  } finally {
    release();
  }
}

async function callModelUnlocked(model: ModelEntry, messages: ChatMessage[], opts: CallOpts = {}): Promise<CallResult> {
  const url = buildEndpointUrl(model.base_url, opts.tools);
  const body = buildBody(model, messages, opts, false);
  const timeoutMs = resolveTimeoutMs();
  const resp = await requestCompletion(url, body, model.api_key, model.model_name, timeoutMs, opts.signal);

  const data = (await resp.json()) as {
    choices?: {
      finish_reason?: string | null;
      message?: {
        content?: string | null;
        reasoning_content?: string | null;
        tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
      };
    }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = data.choices?.[0];
  const msg = choice?.message;
  const finishReason = choice?.finish_reason ?? '';
  const content = msg?.content ?? '';
  const toolCalls: ToolCall[] =
    msg?.tool_calls?.map((tc) => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments })) ?? [];

  const inTok = data.usage?.prompt_tokens ?? 0;
  const outTok = data.usage?.completion_tokens ?? 0;

  logCall({
    sessionId: opts.sessionId,
    mode: opts.mode,
    modelId: model.id,
    modelName: model.model_name,
    inputTokens: inTok,
    outputTokens: outTok,
    priceInput: model.price_input,
    priceOutput: model.price_output,
  });

  // 空响应诊断：DeepSeek 文档指出 finish_reason=length 表示被 max_tokens 截断，
  // 思考模型(reasoner)尤其易触发；给出明确原因便于定位。
  if (!content && toolCalls.length === 0) {
    const hint =
      finishReason === 'length'
        ? '输出被 max_tokens 截断(finish=length)，请调大 maxTokens 或避免使用思考模型(deepseek-reasoner)'
        : `模型未返回任何内容(finish=${finishReason || 'unknown'})`;
    const err = new Error(hint) as Error & { status?: number };
    throw err;
  }

  return { content, toolCalls, inputTokens: inTok, outputTokens: outTok, model };
}

/**
 * 流式调用：POST stream:true，逐块 yield 内容/tool_calls 增量，最后 yield done（含汇总）。
 * 解析 OpenAI 兼容 SSE（data: {...} 行，[DONE] 结束）。
 * 同一模型并发会被 per-model 锁串行化（锁覆盖整个流式生命周期，消费方提前 break 也会释放）。
 */
export async function* streamModel(
  model: ModelEntry,
  messages: ChatMessage[],
  opts: CallOpts = {},
): AsyncGenerator<StreamEvent> {
  const release = await acquireModelLock(model.id);
  try {
    yield* streamModelUnlocked(model, messages, opts);
  } finally {
    release();
  }
}

async function* streamModelUnlocked(
  model: ModelEntry,
  messages: ChatMessage[],
  opts: CallOpts = {},
): AsyncGenerator<StreamEvent> {
  const url = buildEndpointUrl(model.base_url, opts.tools);
  const body = buildBody(model, messages, opts, true);
  const timeoutMs = resolveTimeoutMs();
  const resp = await requestCompletion(url, body, model.api_key, model.model_name, timeoutMs, opts.signal);

  if (!resp.body) throw new Error('模型流式响应无 body（可能不支持 stream），请改用非流式');

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let content = '';
  const toolParts = new Map<number, { id: string; name: string; args: string }>();
  let finishReason = '';
  let lastUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          yield yieldDone();
          return;
        }
        let ev: {
          choices?: {
            delta?: {
              content?: string | null;
              reasoning_content?: string | null;
              tool_calls?: {
                index?: number;
                id?: string;
                type?: string;
                function?: { name?: string; arguments?: string };
              }[];
            };
            finish_reason?: string | null;
          }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        try {
          ev = JSON.parse(payload);
        } catch {
          continue; // 忽略非 JSON 行（注释等）
        }
        const choice = ev.choices?.[0];
        const delta = choice?.delta;
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (ev.usage && (ev.usage.prompt_tokens || ev.usage.completion_tokens)) lastUsage = ev.usage;
        if (delta?.content) {
          content += delta.content;
          yield { kind: 'content', text: delta.content };
        }
        for (const tc of delta?.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          const cur = toolParts.get(idx) ?? { id: tc.id ?? '', name: tc.function?.name ?? '', args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          toolParts.set(idx, cur);
          yield { kind: 'tool_call_args', index: idx, name: cur.name, argsDelta: tc.function?.arguments ?? '' };
        }
      }
    }
    // 流结束但没遇到 [DONE] 或 usage 在最后一行
    const tail = buf.replace(/\r$/, '');
    if (tail.startsWith('data:')) {
      const payload = tail.slice(5).trim();
      if (payload !== '[DONE]') {
        try {
          const ev = JSON.parse(payload);
          if (ev.usage) lastUsage = ev.usage;
          const fr = ev.choices?.[0]?.finish_reason;
          if (fr) finishReason = fr;
        } catch {
          /* ignore */
        }
      }
    }
    // 空响应诊断（与 callModel 一致）
    if (!content && toolParts.size === 0) {
      throw new Error(
        finishReason === 'length'
          ? '输出被 max_tokens 截断(finish=length)，请调大 maxTokens 或避免使用思考模型(deepseek-reasoner)'
          : `模型未返回任何内容(finish=${finishReason || 'unknown'})`,
      );
    }
    yield yieldDone();
    return;

    /** 汇总 done 事件：拼接 tool_calls、估算/提取 token 并记账 */
    function yieldDone(): StreamEvent {
      const toolCalls: ToolCall[] = [...toolParts.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => ({ id: v.id, name: v.name, arguments: v.args }));
      const inTok = lastUsage?.prompt_tokens ?? estimateTokens(JSON.stringify(messages));
      const outTok = lastUsage?.completion_tokens ?? estimateTokens(content);
      logCall({
        sessionId: opts.sessionId,
        mode: opts.mode,
        modelId: model.id,
        modelName: model.model_name,
        inputTokens: inTok,
        outputTokens: outTok,
        priceInput: model.price_input,
        priceOutput: model.price_output,
      });
      return { kind: 'done', content, toolCalls, inputTokens: inTok, outputTokens: outTok, finishReason };
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(opts.signal?.aborted ? '流式请求被中止' : `流式调用超时（${timeoutMs}ms）: ${model.model_name}`);
    }
    throw err;
  } finally {
    // 提前中止/结束时释放 reader（幂等：已释放则忽略）
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

/**
 * 宽松化文本 → 合法 JSON：针对 LLMs 偶发输出的 JS-style key、单引号、尾逗号、注释。
 * 注意：只做保守正则替换，足够处理常见错误模式即可；不引入依赖。
 */
function lenientJsonify(src: string): string {
  let s = src.trim();
  // 去 // 行注释
  s = s.replace(/^\s*\/\/.*$/gm, '');
  // 去 /* */ 块注释
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  // 尾逗号：对象/数组里 ", }" 和 ", ]" → "}"/"]"
  s = s.replace(/,(\s*[}\]])/g, '$1');
  // 单引号包的字符串 → 双引号（同时转义内容里的未转义双引号），含 key:"value"/'key':"value" 两种位置
  s = s.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, inner: string) => {
    const escaped = inner.replace(/(?<!\\)"/g, '\\"');
    return '"' + escaped + '"';
  });
  // unquoted key（冒号/逗号/空格开头的 bare identifier followed by :）→ 加双引号
  s = s.replace(/([{,])\s*([A-Za-z_$][\w$]*)\s*:/g, (_m, lead: string, key: string) => `${lead}"${key}":`);
  return s;
}

/** 提取结构化 JSON：模型可能返回纯 JSON，也可能包在 markdown 中（文本回退路径）。 */
export function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const tryParse = (s: string): unknown | undefined => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  const tryStrict = (s: string): unknown | undefined => {
    const v = tryParse(s);
    if (v !== undefined) return v;
    return tryParse(lenientJsonify(s));
  };
  const direct = tryStrict(trimmed);
  if (direct !== undefined) return direct;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const v = tryStrict(fence[1].trim());
    if (v !== undefined) return v;
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) {
    const v = tryStrict(trimmed.slice(first, last + 1));
    if (v !== undefined) return v;
  }
  // 数组兜底
  const fa = trimmed.indexOf('[');
  const la = trimmed.lastIndexOf(']');
  if (fa !== -1 && la > fa && (first === -1 || fa < first)) {
    const v = tryStrict(trimmed.slice(fa, la + 1));
    if (v !== undefined) return v;
  }
  throw new Error('AI 输出无法解析为 JSON: ' + trimmed.slice(0, 200));
}

/** 宽松解析 JSON：先标准，失败则 lenientJsonify 后再解析。 */
function parseLenient<T = unknown>(s: string): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return JSON.parse(lenientJsonify(s)) as T;
  }
}

/**
 * 从工具调用或文本内容中解析 {action, choice, chat}（选编号/动作编码与聊天分离）。
 * 多个 tool_calls 时优先取名为 make_move 的（兼容模型一次输出多个候选），
 * 其余忽略；均无法解析则抛出带 raw 上下文的错误。
 */
export function parseActionResponse(res: CallResult): { action?: unknown; choice?: unknown; chat?: string; raw: unknown } {
  if (res.toolCalls.length > 0) {
    // 优先 make_move；否则取第一个
    const tc: ToolCall | undefined =
      res.toolCalls.find((t) => t.name === 'make_move') ?? res.toolCalls[0];
    const raw = tc.arguments;
    try {
      const args = parseLenient<Record<string, unknown>>(raw);
      return { action: args.action, choice: args.choice, chat: typeof args.chat === 'string' ? args.chat : undefined, raw };
    } catch (e) {
      // 仍然解析失败：把 raw 作为解析错误抛出的上下文
      const err = new Error('工具调用 arguments 不是合法 JSON: ' + (e as Error).message) as Error & { raw?: unknown };
      err.raw = raw;
      throw err;
    }
  }
  const parsed = extractJson(res.content) as { action?: unknown; choice?: unknown; chat?: string } | undefined;
  return { action: parsed?.action, choice: parsed?.choice, chat: parsed?.chat, raw: res.content };
}
