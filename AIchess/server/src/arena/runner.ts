import type { GameAdapter, GameOverInfo, PlayerSeat } from '../games/types.js';
import { sampleSeats, pickWatcherModels } from '../modelPool/pool.js';
import type { ModelEntry } from '../modelPool/store.js';
import { callModel, parseActionResponse, type CallOpts, type ChatMessage, type ToolDef, type ToolCall } from '../modelPool/provider.js';
import { getGame } from '../games/registry.js';
import { buildXiangqiPrompt, XIANGQI_TOOL, XIANGQI_TOOL_CHOICE } from '../games/xiangqi/prompt.js';

export interface ArenaSeat {
  seatIndex: number;
  model: ModelEntry;
  sideLabel: string;
}

export type ArenaEvent =
  | { type: 'init'; seats: ArenaSeat[]; watchers: ModelEntry[]; state: unknown }
  | { type: 'state'; state: unknown }
  | { type: 'thinking'; seat: number; model: string }
  | { type: 'move'; seat: number; model: string; action: unknown; describe: string; chat?: string; tokensIn: number; tokensOut: number; viaTool: boolean }
  | { type: 'illegal'; seat: number; raw: unknown; reason: string }
  | { type: 'watcher'; index: number; model: string; text: string; confidence: number }
  | { type: 'human'; text: string }
  | { type: 'over'; winner: PlayerSeat | null; reason: string; seats: ArenaSeat[] }
  | { type: 'error'; message: string };

type Emit = (e: ArenaEvent) => void;

interface RunnerConfig {
  gameId: string;
  seats: number;
  watcherCount: number;
  emit: Emit;
  sessionId: string;
  moveDelayMs?: number;
  watcherEvery?: number;
  maxRetries?: number;
  watcherConfidenceRange?: [number, number]; // 默认 [-0.2,-0.1]（干扰/低可信）
  /** 默认 true：AI 连续非法用尽后，系统代走一个合法着法以维持对局流畅；false 则直接判负。 */
  autoMoveOnIllegal?: boolean;
}

interface WatcherComment {
  text: string;
  confidence: number;
}

function randInRange(a: number, b: number) {
  return a + Math.random() * (b - a);
}

/**
 * 瞬时错误分类（业界通用语义）：
 * - 无 status（网络中断/超时/Abort）→ 瞬时
 * - 429 限流、5xx 服务端错误 → 瞬时
 * - 4xx（400/401/403/404/422/501…）→ 永久（改请求方式/降级，重试无益）
 */
function isTransientError(e: Error & { status?: number }): boolean {
  if (e.status === undefined) return true;
  return e.status === 429 || e.status >= 500;
}

/** 是否计入熔断：429 只是限流（等 Retry-After 即可），不是模型故障，不熔断 */
function isBreakerWorthy(e: Error & { status?: number }): boolean {
  if (e.status === undefined) return true; // 网络/超时 → 记
  return e.status >= 500; // 5xx → 记；429/4xx 不记
}

/** 指数退避：第 n 次失败后等待 min(base * 2^(n-1), cap) ms */
function backoffMs(n: number, base = 400, cap = 5000): number {
  return Math.min(base * 2 ** (n - 1), cap);
}

/** 熔断器：某模型连续失败达阈值后进入冷却，避免反复打一个挂掉的端点 */
interface ModelBreaker {
  consecutiveFails: number;
  downUntil: number; // 0 = 健康；epoch ms 之前视为熔断
  downReason: string;
}
const BREAKER_THRESHOLD = 3; // 连续失败次数
const BREAKER_COOLDOWN_MS = 30_000; // 冷却时长

export class ArenaRunner {
  private game!: GameAdapter<unknown, unknown>;
  private state!: unknown;
  private seatModels: ArenaSeat[] = [];
  private watchers: ModelEntry[] = [];
  private watcherComments: WatcherComment[] = [];
  private history: unknown[] = [];
  private running = false;
  private stopped = false;
  private started = false; // 并发守卫：start() 只允许执行一次
  // 某些模型不支持 tools / tool_choice，命中后该座位回退到文本 JSON 模式
  private textFallback = new Set<number>();
  // strict 模式不被支持时，先降级为非 strict 工具调用（仍走结构化 tool_calls）
  private nonStrictFallback = new Set<number>();
  // 模型健康度熔断器（按 model.id）
  private breakers = new Map<string, ModelBreaker>();

  constructor(private cfg: RunnerConfig) {}

  async start(): Promise<void> {
    if (this.started) return; // 防止重复启动
    this.started = true;
    const game = getGame(this.cfg.gameId);
    if (!game) throw new Error('未知游戏: ' + this.cfg.gameId);
    this.game = game;
    if (this.cfg.seats < game.minSeats || this.cfg.seats > game.maxSeats)
      throw new Error(`${game.name} 需要 ${game.minSeats}~${game.maxSeats} 个 AI，当前 ${this.cfg.seats}`);

    const sampled = sampleSeats(this.cfg.seats);
    this.seatModels = sampled.map((s, i) => ({
      seatIndex: i,
      model: s.model,
      sideLabel: i === 0 ? '红方' : '黑方',
    }));
    this.watchers = pickWatcherModels(this.cfg.watcherCount);

    this.state = game.createInitial(this.cfg.seats);
    this.cfg.emit({ type: 'init', seats: this.seatModels, watchers: this.watchers, state: this.state });
    this.cfg.emit({ type: 'state', state: this.state });

    this.running = true;
    await this.loop();
  }

  stop() {
    this.stopped = true;
  }

  /** 玩家观战文本：进入聊天流，并作为低置信度上下文片段注入下棋 AI */
  pushHumanText(text: string) {
    this.cfg.emit({ type: 'human', text });
    this.watcherComments.push({ text: `[玩家] ${text}`, confidence: +randInRange(-0.1, 0.1).toFixed(2) });
    if (this.watcherComments.length > 8) this.watcherComments.shift();
  }

  /** 记录一次失败 → 可能触发熔断 */
  private recordFailure(model: ModelEntry, reason: string): boolean {
    const b = this.breakers.get(model.id) ?? { consecutiveFails: 0, downUntil: 0, downReason: '' };
    b.consecutiveFails++;
    if (b.consecutiveFails >= BREAKER_THRESHOLD && b.downUntil === 0) {
      b.downUntil = Date.now() + BREAKER_COOLDOWN_MS;
      b.downReason = reason;
    }
    this.breakers.set(model.id, b);
    return b.downUntil > Date.now();
  }

  /** 记录一次成功 → 重置健康度 */
  private recordSuccess(model: ModelEntry) {
    this.breakers.delete(model.id);
  }

  /** 是否处于熔断冷却 */
  private isTripped(model: ModelEntry): ModelBreaker | null {
    const b = this.breakers.get(model.id);
    if (!b || b.downUntil === 0) return null;
    if (Date.now() >= b.downUntil) {
      // 冷却结束，恢复
      this.breakers.delete(model.id);
      return null;
    }
    return b;
  }

  private async loop(): Promise<void> {
    const delay = this.cfg.moveDelayMs ?? 400;
    const watcherEvery = this.cfg.watcherEvery ?? 2;
    const maxRetries = this.cfg.maxRetries ?? 3;
    const confRange = this.cfg.watcherConfidenceRange ?? [-0.2, -0.1];

    while (this.running && !this.stopped) {
      const seat = this.game.currentPlayer(this.state);
      const seatInfo = this.seatModels[seat];
      if (!seatInfo) {
        this.cfg.emit({ type: 'error', message: `座位 ${seat} 未绑定模型，对局终止` });
        this.running = false;
        break;
      }
      this.cfg.emit({ type: 'thinking', seat, model: seatInfo.model.model_name });

      let applied = false;
      let viaTool = false;
      let attempt = 0;
      let correction = '';
      let transientBackoff = 0; // 瞬时错误累计退避次数
      while (attempt <= maxRetries && !applied && !this.stopped) {
        attempt++;

        // 熔断检查：模型处于冷却期 → 直接系统代走，不再打端点
        const tripped = this.isTripped(seatInfo.model);
        if (tripped) {
          this.cfg.emit({
            type: 'illegal',
            seat,
            raw: null,
            reason: `模型 ${seatInfo.model.model_name} 熔断冷却中（${tripped.downReason}），本次系统代走`,
          });
          break;
        }

        // 本尝试中模型是否「无视 tools、直接返回了普通文本」——若是且解析失败，说明模型不支持工具调用，应切文本 JSON
        let respondedPlainText = false;
        try {
          const spec = this.buildCallSpec(seat, correction);
          const res = await callModel(seatInfo.model, spec.messages, spec.opts);
          this.recordSuccess(seatInfo.model);
          viaTool = res.toolCalls.length > 0;
          respondedPlainText = !viaTool && (spec.opts.tools?.length ?? 0) > 0;
          const rawParsed = parseActionResponse(res);
          // 解析层：choice/action 均可，解析失败抛出 Error 走 correction
          const action = this.resolveAction(seat, rawParsed as never, spec.legalActions);
          const describe = this.game.describeAction(this.state, action);
          this.state = this.game.applyAction(this.state, seat, action);
          this.history.push(action);
          this.cfg.emit({
            type: 'move',
            seat,
            model: seatInfo.model.model_name,
            action,
            describe,
            chat: (rawParsed as { chat?: string }).chat,
            tokensIn: res.inputTokens,
            tokensOut: res.outputTokens,
            viaTool,
          });
          this.cfg.emit({ type: 'state', state: this.state });
          applied = true;
        } catch (err) {
          const e = err as Error & { status?: number; retryAfterMs?: number };
          // 瞬时错误（网络/超时/5xx/429）→ 退避后重试，不发 correction（模型没做错，是通道问题）
          if (isTransientError(e)) {
            transientBackoff++;
            // 429 带 Retry-After 时按其等待，否则指数退避；429 不计入熔断
            if (isBreakerWorthy(e)) this.recordFailure(seatInfo.model, e.message);
            const wait = e.retryAfterMs ? Math.max(e.retryAfterMs, 100) : backoffMs(transientBackoff);
            this.cfg.emit({ type: 'illegal', seat, raw: null, reason: `瞬时错误（${e.message}），${wait}ms 后重试（第${attempt}次）` });
            if (attempt <= maxRetries && !this.stopped) await sleep(wait);
            continue;
          }
          // 第三级兜底（优先于 strict 降级）：模型无视 tools 直接输出文本且解析失败 → 切文本 JSON
          if (respondedPlainText && !this.textFallback.has(seat)) {
            this.textFallback.add(seat);
            this.cfg.emit({ type: 'illegal', seat, raw: null, reason: '模型未返回工具调用，切换文本JSON回退' });
            correction =
              '合法着法已编号列出。请输出一个 JSON 对象（无需代码块、无需解释）：{"choice":0,"chat":"..."}，其中 choice 是列表中的某个整数编号。';
            continue;
          }
          const unsupportedTools = e.status === 400 || e.status === 422 || e.status === 501;
          // 第一级：strict 模式不被支持 → 降级为非 strict 工具调用（仍走结构化 tool_calls）
          if (unsupportedTools && !this.nonStrictFallback.has(seat) && !this.textFallback.has(seat)) {
            this.nonStrictFallback.add(seat);
            this.cfg.emit({ type: 'illegal', seat, raw: null, reason: 'strict 模式不被支持，降级为非 strict 工具调用' });
            continue;
          }
          // 第二级：工具调用整体不被支持 → 降级为纯文本 JSON
          if (unsupportedTools && this.nonStrictFallback.has(seat) && !this.textFallback.has(seat)) {
            this.textFallback.add(seat);
            this.cfg.emit({ type: 'illegal', seat, raw: null, reason: '模型不支持工具调用，切换文本JSON回退' });
            correction =
              '合法着法已编号列出。请输出一个 JSON 对象（无需代码块、无需解释）：{"choice":0,"chat":"..."}，其中 choice 是列表中的某个整数编号。';
            continue;
          }
          // 永久错误（4xx）且非降级链：记录熔断计数 + 给 correction，明确告诉用 choice
          this.recordFailure(seatInfo.model, e.message);
          const legals = this.game.legalActions(this.state, seat) as unknown[];
          const sampleNums = legals
            .slice(0, 6)
            .map((_, i) => String(i))
            .join(', ');
          correction = `上一步错误：${e.message}。请重新调用 make_move 并在 choice 中提交合法编号（示例编号 ${sampleNums}，范围 0 ~ ${legals.length - 1}）。严禁自行发明坐标或越界编号。`;
          this.cfg.emit({ type: 'illegal', seat, raw: (err as { raw?: unknown }).raw ?? e.message, reason: e.message + '(第' + attempt + '次)' });
        }
      }

      if (!applied) {
        // 非法用尽 / 熔断：娱乐/流畅优先，系统从合法着法中代走一步，避免对局频繁中断判负
        if (this.cfg.autoMoveOnIllegal !== false) {
          const legals = this.game.legalActions(this.state, seat) as unknown[];
          if (legals.length > 0) {
            const action = legals[Math.floor(Math.random() * legals.length)];
            const describe = this.game.describeAction(this.state, action);
            this.state = this.game.applyAction(this.state, seat, action);
            this.history.push(action);
            this.cfg.emit({
              type: 'move',
              seat,
              model: seatInfo.model.model_name,
              action,
              describe,
              chat: '【系统代走】模型连续输出非法着法',
              tokensIn: 0,
              tokensOut: 0,
              viaTool: false,
            });
            this.cfg.emit({ type: 'state', state: this.state });
            this.cfg.emit({ type: 'illegal', seat, raw: null, reason: '连续非法着法，系统已代走合法着法' });
            applied = true;
          }
        }
        if (!applied) {
          const winner = this.cfg.seats === 2 ? 1 - seat : null;
          this.cfg.emit({
            type: 'over',
            winner,
            reason: `${seatInfo.model.model_name}(${seatInfo.sideLabel}) 连续输出非法/无效着法判负`,
            seats: this.seatModels,
          });
          this.running = false;
          break;
        }
      }

      const over = this.game.isGameOver(this.state);
      if (over) {
        this.cfg.emit({ type: 'over', winner: over.winner, reason: over.reason, seats: this.seatModels });
        this.running = false;
        break;
      }

      // 观战 AI 评论：非阻塞并行执行，不拖慢主对局节奏
      if (this.watchers.length > 0 && this.history.length % watcherEvery === 0) {
        void this.runWatchers(confRange);
      }

      await sleep(delay);
    }
  }

  private buildCallSpec(seat: PlayerSeat, correction: string): {
    messages: ChatMessage[];
    opts: CallOpts;
    legalActions: unknown[];
  } {
    let messages: ChatMessage[];
    const useText = this.textFallback.has(seat);
    // 枚举本局合法着法，交给 LLM 选编号（业界标准：LLM 选编号，不发明坐标）。
    const legalActions = this.game.legalActions(this.state, seat);
    if (this.game.id === 'xiangqi') {
      messages = buildXiangqiPrompt(
        this.state as never,
        seat,
        this.history as never,
        this.watcherComments,
        { legalActions: legalActions as never },
      );
    } else {
      const enc = this.game.encode(this.state);
      messages = [
        { role: 'system', content: `你是 ${this.game.name} 对局 AI。${this.game.actionSchemaDoc()}` },
        { role: 'user', content: `状态: ${enc.compact}\n${enc.readable}\n请输出动作 JSON。` },
      ];
    }
    if (correction) messages.push({ role: 'user', content: correction });

    if (useText) {
      // 文本回退：不用 json_mode（DeepSeek 文档要求 prompt 含 "json" 否则会卡住生成空白），
      // 改用 extractJson 从纯文本/markdown 中提取；关闭思考避免 max_tokens 被思考耗尽截断。
      return {
        messages,
        opts: { temperature: 0.4, maxTokens: 1024, sessionId: this.cfg.sessionId, mode: 'ava', thinking: 'disabled' },
        legalActions,
      };
    }
    // 工具调用路径：strict 不被支持时，clone 工具并关闭 strict（仍走结构化 tool_calls）
    let tools: ToolDef[] | undefined = this.game.id === 'xiangqi' ? [XIANGQI_TOOL] : undefined;
    if (tools && this.nonStrictFallback.has(seat)) {
      tools = tools.map((t) => ({ ...t, function: { ...t.function, strict: false } }));
    }
    return {
      messages,
      opts: {
        temperature: 0.4,
        maxTokens: 512,
        sessionId: this.cfg.sessionId,
        mode: 'ava',
        thinking: 'disabled',
        tools,
        toolChoice: this.game.id === 'xiangqi' ? XIANGQI_TOOL_CHOICE : undefined,
      },
      legalActions,
    };
  }

  /**
   * 把 AI 输出解析为 action。
   * - 新枚举模式（xiangqi）：AI 输出 {choice:int|string}  → 到 legalActions 里取对应编号。
   * - 兼容旧 action 四元数组：如果 AI 给的是 action 则直接用。
   * - 任何越界/无效解析：抛出 Error 让重试链路继续给 correction。
   */
  private resolveAction(seat: PlayerSeat, parsed: { action?: unknown; choice?: unknown; chat?: string; raw: unknown }, legalActions: unknown[]): unknown {
    // 优先新枚举模式 choice（容忍字符串数字，如 "3"、" 3 "）
    if (parsed.choice !== undefined && parsed.choice !== null && parsed.choice !== '') {
      const n = typeof parsed.choice === 'number' ? parsed.choice : Number(String(parsed.choice).trim());
      if (!Number.isInteger(n) || n < 0 || n >= legalActions.length) {
        throw new Error(`choice=${String(parsed.choice)} 越界或非整数，合法范围 0~${legalActions.length - 1}`);
      }
      return legalActions[n];
    }
    // 回退到旧 action 四元数组（保留兼容，重试时 correction 会建议用 choice）
    if (this.game.isLegal(this.state, seat, parsed.action)) {
      return parsed.action;
    }
    throw new Error('输出既无合法 choice 也无合法 action');
  }

  private async runWatchers(confRange: [number, number]): Promise<void> {
    const enc = this.game.encode(this.state);
    const lastMove = this.history.length
      ? this.game.describeAction(this.state, this.history[this.history.length - 1])
      : '开局';
    await Promise.all(
      this.watchers.map(async (w, i) => {
        try {
          const res = await callModel(
            w,
            [
              {
                role: 'system',
                content:
                  '你是一名中国象棋观战 AI 评论员，可自由评论棋局，语气不限、风格不限，输出仅一句简短中文评论，不要输出着法。',
              },
              { role: 'user', content: `当前棋盘:\n${enc.readable}\n上一步: ${lastMove}\n请点评一句。` },
            ],
            { temperature: 1.0, maxTokens: 80, sessionId: this.cfg.sessionId, mode: 'watcher' },
          );
          const text = res.content.trim().replace(/\s+/g, ' ').slice(0, 120);
          const confidence = +randInRange(confRange[0], confRange[1]).toFixed(2);
          this.cfg.emit({ type: 'watcher', index: i, model: w.model_name, text, confidence });
          this.watcherComments.push({ text, confidence });
          if (this.watcherComments.length > 8) this.watcherComments.shift();
        } catch {
          // 观战失败不影响对局
        }
      }),
    );
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
