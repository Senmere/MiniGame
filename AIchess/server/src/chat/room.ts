import { sampleSeats } from '../modelPool/pool.js';
import type { ModelEntry } from '../modelPool/store.js';
import { callModel, streamModel, type ChatMessage, type CallOpts } from '../modelPool/provider.js';

export type ChatEvent =
  | { type: 'init'; members: { index: number; model: string }[] }
  | { type: 'message'; index: number | 'human'; model?: string; text: string }
  | { type: 'thinking'; index: number; model: string }
  /** 流式增量：同一 index 的多个 delta 事件拼接成完整发言 */
  | { type: 'delta'; index: number; delta: string }
  | { type: 'over'; reason: string }
  | { type: 'error'; message: string };

type Emit = (e: ChatEvent) => void;

interface ChatConfig {
  memberCount: number; // 对话 AI 数量
  injectHumanContext: boolean; // 人类发言是否注入 AI 上下文
  emit: Emit;
  sessionId: string;
  topic?: string; // 可选话题
  turnDelayMs?: number;
  maxRounds?: number;
  temperature?: number;
  /** 是否开启思考模式。deepseek 会在 reasoning_content 放思考，不在 content 里；
   *  false（默认）→ 关 thinking，提速、避免 token 被思考耗光；
   *  true → 开 thinking，输出更长、带思维链。 */
  thinking?: boolean;
  /** 单次最大 token。思考模式建议 ≥800。 */
  maxTokens?: number;
}

interface RoomMember {
  index: number;
  model: ModelEntry;
}

/**
 * 纯 AI 对话房间。
 * 与棋牌模式不同：此模式不涉及动作编码，所有输出均为自然语言。
 * 多 AI 轮流发言，玩家可插入自己的发言（可配置是否注入上下文）。
 */
export class ChatRoom {
  private members: RoomMember[] = [];
  private transcript: { index: number | 'human'; model?: string; text: string }[] = [];
  private running = false;
  private stopped = false;
  private round = 0;
  /** 当前正在进行的流式调用的中止控制器（stop() 时中断，立即停止出字） */
  private currentAbort: AbortController | null = null;

  constructor(private cfg: ChatConfig) {}

  async start(): Promise<void> {
    const sampled = sampleSeats(this.cfg.memberCount);
    this.members = sampled.map((s, i) => ({ index: i, model: s.model }));
    this.cfg.emit({
      type: 'init',
      members: this.members.map((m) => ({ index: m.index, model: m.model.model_name })),
    });

    this.running = true;
    await this.loop();
  }

  stop() {
    this.stopped = true;
    this.currentAbort?.abort(); // 中断正在进行的流式输出
  }

  /** 玩家插入发言 */
  async pushHumanText(text: string): Promise<void> {
    if (this.stopped) return; // 房间已停止，忽略
    this.transcript.push({ index: 'human', text });
    this.cfg.emit({ type: 'message', index: 'human', text });
    if (this.cfg.injectHumanContext) {
      // 注入后立即让下一个 AI 回应（若已停止则忽略）
      // 不立即推动 loop，loop 会自然处理
    }
  }

  private async loop(): Promise<void> {
    const delay = this.cfg.turnDelayMs ?? 1200;
    const maxRounds = this.cfg.maxRounds ?? 40;
    const temperature = this.cfg.temperature; // undefined → 不传，让模型用自身默认值（兼容 kimi 等）
    const thinkingOn = !!this.cfg.thinking;
    const maxTokens = this.cfg.maxTokens ?? (thinkingOn ? 1500 : 500);

    while (this.running && !this.stopped && this.round < maxRounds) {
      for (const member of this.members) {
        if (this.stopped) break;
        this.cfg.emit({ type: 'thinking', index: member.index, model: member.model.model_name });
        try {
          const messages = this.buildMessages(member.index);
          const opts: CallOpts = {
            temperature,
            sessionId: this.cfg.sessionId,
            mode: 'chat',
            maxTokens,
            thinking: thinkingOn ? 'enabled' : 'disabled',
          };
          const text = await this.speakStreaming(member, messages, opts);
          if (!text) {
            this.cfg.emit({ type: 'error', message: `AI#${member.index} 返回空内容，已跳过本轮。` });
            continue;
          }
          this.transcript.push({ index: member.index, model: member.model.model_name, text });
          this.cfg.emit({ type: 'message', index: member.index, model: member.model.model_name, text });
        } catch (err) {
          if (this.stopped) break; // 停止过程中中断流 → 不报错
          this.cfg.emit({ type: 'error', message: (err as Error).message });
        }
        await sleep(delay);
      }
      this.round++;
    }
    if (!this.stopped) {
      this.cfg.emit({ type: 'over', reason: this.round >= maxRounds ? '达到最大轮次' : '已结束' });
    }
    this.running = false;
  }

  /**
   * 流式发言：逐个 content 增量 emit delta 事件，返回完整文本。
   * 流式失败（模型不支持 stream / 网络中断）时自动回退到非流式 callModel。
   */
  private async speakStreaming(member: RoomMember, messages: ChatMessage[], opts: CallOpts): Promise<string> {
    const abort = new AbortController();
    this.currentAbort = abort;
    const parts: string[] = [];
    let sawContent = false;
    try {
      try {
        for await (const ev of streamModel(member.model, messages, { ...opts, signal: abort.signal })) {
          if (this.stopped) {
            abort.abort();
            return parts.join('');
          }
          if (ev.kind === 'content') {
            sawContent = true;
            parts.push(ev.text);
            this.cfg.emit({ type: 'delta', index: member.index, delta: ev.text });
          }
        }
        return parts.join('').trim();
      } catch (err) {
        // 用户主动停止：直接返回已收集内容，不再回退
        if (abort.signal.aborted || this.stopped) return parts.join('').trim();
        // 流式失败（不支持 stream / 超时等）→ 回退非流式
        if (!sawContent) {
          const res = await callModel(member.model, messages, { ...opts, signal: abort.signal });
          const text = res.content.trim();
          if (text) this.cfg.emit({ type: 'delta', index: member.index, delta: text });
          return text;
        }
        throw err;
      }
    } finally {
      if (this.currentAbort === abort) this.currentAbort = null;
    }
  }

  private buildMessages(myIndex: number): ChatMessage[] {
    const myModel = this.members[myIndex].model.model_name;
    const others = this.members
      .filter((m) => m.index !== myIndex)
      .map((m) => `AI#${m.index}(${m.model.model_name})`)
      .join('、');
    const system = [
      `你正在一个多 AI 聊天室中与其他成员自由对话。你的身份是 AI#${myIndex}(${myModel})。`,
      others ? `其他成员: ${others}` : '目前你是唯一成员。',
      this.cfg.topic ? `讨论话题: ${this.cfg.topic}` : '可自由选择话题，保持对话自然流畅，每次发言简短(一两句)。',
      '直接输出你的发言正文，不要加角色标签。',
    ].join('\n');

    const history: ChatMessage[] = [{ role: 'system', content: system }];
    for (const t of this.transcript.slice(-12)) {
      if (t.index === 'human') {
        if (this.cfg.injectHumanContext) {
          history.push({ role: 'user', content: `[玩家]: ${t.text}` });
        }
        continue;
      }
      if (t.index === myIndex) {
        history.push({ role: 'assistant', content: t.text });
      } else {
        history.push({ role: 'user', content: `[AI#${t.index}]: ${t.text}` });
      }
    }
    if (history[history.length - 1].role !== 'user') {
      history.push({ role: 'user', content: '请接上话题，发表你的看法。' });
    }
    return history;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
