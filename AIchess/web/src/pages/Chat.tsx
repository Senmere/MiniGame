import { useEffect, useMemo, useRef, useState } from 'react';
import { socket } from '../socket.js';
import { Markdown } from '../components/Markdown.js';
import { api } from '../api/client.js';

type Index = number | 'human' | 'system';

interface MsgSeg {
  id: number;
  /** 原始整条消息的 id（用于 thinking 替换 / 分段归属同一条） */
  groupId: number;
  /** 说话人。system 用于「开启对话」「对话结束」等时间线信息。 */
  index: Index;
  model?: string;
  /** 分段渲染时：该段序号 */
  seg: number;
  /** 本段文本（或 HTML 渲染前的原文） */
  text: string;
  /** 是否是"正在发言…"占位气泡（随后会被真实内容替换） */
  thinking?: boolean;
  /** 气泡侧：right=用户，left=AI，center=系统提示 */
  side: 'right' | 'left' | 'center';
}

interface ChatEvent {
  sessionId: string;
  event:
    | { type: 'init'; members: { index: number; model: string }[] }
    | { type: 'message'; index: number | 'human'; model?: string; text: string }
    | { type: 'thinking'; index: number; model: string }
    | { type: 'delta'; index: number; delta: string }
    | { type: 'over'; reason: string }
    | { type: 'error'; message: string }
    | Record<string, unknown>;
}

function colorForIndex(i: number): string {
  const palette = ['#07c160', '#10aeff', '#ff9500', '#c56cf0', '#ff6482', '#3dcdb0', '#7a5cff', '#f7b500'];
  return palette[i % palette.length];
}

function shortName(model?: string): string {
  if (!model) return 'AI';
  const m = model;
  const parts = m.split(/[-_/]/).filter(Boolean);
  const last = parts[parts.length - 1];
  if (last && last.length <= 8) return last;
  return m.slice(0, 10);
}

/** 按空行切分成多条消息段落，用户看像"连发多个气泡"。连续单个 \n 保留在段内。 */
function splitParagraphs(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n');
  return normalized
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function Chat() {
  const [memberCount, setMemberCount] = useState(3);
  const [topic, setTopic] = useState('');
  const [inject, setInject] = useState(true);
  const [maxRounds, setMaxRounds] = useState(20);
  const [turnDelayMs, setTurnDelayMs] = useState(900);
  const [thinking, setThinking] = useState(false);
  const [loadedDefault, setLoadedDefault] = useState(false);

  const [segs, setSegs] = useState<MsgSeg[]>([]);
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [human, setHuman] = useState('');
  /** 当前正在思考的 AI 编号 → groupId。用于"思考→消息"的替换。 */
  const thinkingGroupByIndex = useRef<Record<number, number>>({});
  /** 流式增量缓冲：AI 编号 → 已到达的文本（打字机渲染） */
  const streamBuf = useRef<Record<number, string>>({});
  const nextId = useRef(1);
  const streamRef = useRef<HTMLDivElement>(null);

  // 页面加载后读取全局默认值：chatThinkingDefault / chatTurnDelayMs
  useEffect(() => {
    let alive = true;
    api
      .getSettings()
      .then((s) => {
        if (!alive) return;
        if (typeof s.chatTurnDelayMs === 'number') setTurnDelayMs(s.chatTurnDelayMs);
        if (typeof s.chatThinkingDefault === 'boolean') setThinking(s.chatThinkingDefault);
      })
      .catch(() => {})
      .finally(() => setLoadedDefault(true));
    return () => {
      alive = false;
    };
  }, []);

  const addSeg = (patch: (prev: MsgSeg[]) => MsgSeg[]) => {
    setSegs((prev) => {
      const next = patch(prev);
      return next.slice(-800);
    });
  };

  useEffect(() => {
    const handler = (msg: ChatEvent) => {
      const e = msg.event as any;
      const type = e?.type as string | undefined;
      if (!type) return;

      switch (type) {
        case 'init': {
          const members = e.members as { index: number; model: string }[];
          const id = nextId.current++;
          const text = `对话室开启：${members.map((mm) => `AI#${mm.index}(${mm.model})`).join('、')}`;
          addSeg((prev) => [
            ...prev,
            {
              id,
              groupId: id,
              index: 'system',
              seg: 0,
              text,
              side: 'center',
            },
          ]);
          break;
        }
        case 'thinking': {
          const idx = e.index as number;
          const model = e.model as string;
          // 若同编号 AI 已有未被消息替换的 thinking 气泡：不重复追加
          const existing = thinkingGroupByIndex.current[idx];
          if (existing !== undefined) return;
          const id = nextId.current++;
          thinkingGroupByIndex.current[idx] = id;
          streamBuf.current[idx] = ''; // 新发言开始，清空流式缓冲
          addSeg((prev) => [
            ...prev,
            {
              id,
              groupId: id,
              index: idx,
              model,
              seg: 0,
              text: '', // 流式开始为空，delta 到达后逐步填充
              thinking: true,
              side: 'left',
            },
          ]);
          break;
        }
        case 'delta': {
          const idx = e.index as number;
          const delta = (e.delta ?? '') as string;
          if (!delta) break;
          streamBuf.current[idx] = (streamBuf.current[idx] ?? '') + delta;
          const groupId = thinkingGroupByIndex.current[idx];
          if (groupId === undefined) break; // 没有 thinking 气泡（异常顺序），忽略增量
          const text = streamBuf.current[idx];
          // 只更新 thinking 占位气泡的文本（打字机效果）
          addSeg((prev) =>
            prev.map((s) => (s.groupId === groupId && s.thinking ? { ...s, text } : s)),
          );
          break;
        }
        case 'message': {
          const rawIdx = e.index as number | 'human';
          const model = e.model as string | undefined;
          const fullText = (e.text ?? '') as string;
          const parts = splitParagraphs(fullText);
          if (parts.length === 0) break;

          const groupId =
            typeof rawIdx === 'number' && thinkingGroupByIndex.current[rawIdx] !== undefined
              ? thinkingGroupByIndex.current[rawIdx]
              : nextId.current++;

          if (typeof rawIdx === 'number') {
            // 替换掉 thinking 占位；之后清掉映射与流式缓冲
            thinkingGroupByIndex.current[rawIdx] = undefined as any;
            delete thinkingGroupByIndex.current[rawIdx];
            delete streamBuf.current[rawIdx];
          }

          const side: MsgSeg['side'] = rawIdx === 'human' ? 'right' : 'left';
          addSeg((prev) => {
            // 如果存在旧 thinking 气泡：用真实内容替换
            const filtered = prev.filter((s) => !(s.groupId === groupId && s.thinking));
            const newSegs: MsgSeg[] = parts.map((p, i) => ({
              id: nextId.current++,
              groupId,
              index: rawIdx,
              model,
              seg: i,
              text: p,
              side,
            }));
            return [...filtered, ...newSegs];
          });
          break;
        }
        case 'over':
        case 'error': {
          const text = type === 'over' ? `对话结束：${e.reason}` : `错误：${e.message}`;
          const id = nextId.current++;
          thinkingGroupByIndex.current = {};
          streamBuf.current = {};
          addSeg((prev) => [
            ...prev,
            { id, groupId: id, index: 'system', seg: 0, text, side: 'center' },
          ]);
          if (type === 'over' || type === 'error') {
            setRunning(false);
            setSessionId(''); // 会话已结束，清空 sessionId，禁止继续发言
          }
          break;
        }
      }
    };
    socket.on('chat:event', handler);
    socket.on('chat:started', (d: { sessionId: string }) => setSessionId(d.sessionId));
    return () => {
      socket.off('chat:event', handler);
      socket.off('chat:started');
    };
  }, []);

  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [segs]);

  const start = () => {
    thinkingGroupByIndex.current = {};
    streamBuf.current = {};
    setSegs([]);
    setRunning(true);
    setSessionId('');
    socket.emit('chat:start', {
      memberCount,
      topic: topic.trim() || undefined,
      injectHumanContext: inject,
      maxRounds,
      turnDelayMs,
      thinking,
    });
  };

  const stop = () => {
    if (sessionId) socket.emit('chat:stop', { sessionId });
    thinkingGroupByIndex.current = {};
    streamBuf.current = {};
    setRunning(false);
  };

  const sendHuman = () => {
    const t = human.trim();
    if (!t || !sessionId) return;
    // 先本地显示自己发送的气泡（右侧）
    const groupId = nextId.current++;
    const parts = splitParagraphs(t);
    const local: MsgSeg[] = parts.map((p, i) => ({
      id: nextId.current++,
      groupId,
      index: 'human',
      seg: i,
      text: p,
      side: 'right',
    }));
    addSeg((prev) => [...prev, ...local]);
    socket.emit('chat:human', { sessionId, text: t });
    setHuman('');
  };

  const aliveAiIndex = useMemo(() => {
    const map = thinkingGroupByIndex.current;
    return Object.keys(map).map((k) => Number(k));
  }, [segs]);

  return (
    <div className="chat-page">
      <div className="weui-header">
        <div>
          <h1>AI 对话室</h1>
          <p className="sub">多模型自由对话 · 支持 Markdown · 可选思考模式</p>
        </div>
        {running ? (
          <button className="btn weui-btn weui-btn-warn" onClick={stop}>
            {aliveAiIndex.length ? `停止 · ${aliveAiIndex.length} 人思考中` : '停止对话'}
          </button>
        ) : (
          <button className="btn weui-btn weui-btn-primary" onClick={start}>
            开启对话
          </button>
        )}
      </div>

      <div className="weui-panel weui-config">
        <div className="grid">
          <label>
            <span>AI 数量</span>
            <input
              type="number"
              min={2}
              max={8}
              value={memberCount}
              disabled={running}
              onChange={(e) => setMemberCount(Number(e.target.value))}
            />
          </label>
          <label style={{ gridColumn: 'span 2' }}>
            <span>话题（可选）</span>
            <input
              value={topic}
              disabled={running}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="例如：程序员会不会被 AI 取代"
            />
          </label>
          <label>
            <span>最大轮次</span>
            <input
              type="number"
              min={1}
              max={200}
              value={maxRounds}
              disabled={running}
              onChange={(e) => setMaxRounds(Number(e.target.value))}
            />
          </label>
          <label>
            <span>发言间隔 (ms)</span>
            <input
              type="number"
              min={0}
              step={100}
              value={turnDelayMs}
              disabled={running}
              onChange={(e) => setTurnDelayMs(Number(e.target.value))}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={thinking}
              disabled={running}
              onChange={(e) => setThinking(e.target.checked)}
            />
            <span>开启思考模式（更长输出、思维链）</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={inject}
              disabled={running}
              onChange={(e) => setInject(e.target.checked)}
            />
            <span>玩家发言注入 AI 上下文</span>
          </label>
        </div>
      </div>

      <div className="weui-panel weui-stream">
        <div className="weui-chat" ref={streamRef}>
          {segs.length === 0 && (
            <div className="weui-empty">配置参数后点击右上角「开启对话」…</div>
          )}
          {segs.map((s) => {
            if (s.side === 'center') {
              return (
                <div key={s.id} className="weui-tip">
                  <span>{s.text}</span>
                </div>
              );
            }
            const idx = typeof s.index === 'number' ? s.index : -1;
            const isRight = s.side === 'right';
            const name = isRight
              ? '我'
              : typeof s.index === 'number'
              ? `AI#${s.index} · ${s.model ?? '模型'}`
              : '玩家';
            const initial = isRight ? '我' : (s.model ? shortName(s.model)[0]?.toUpperCase() ?? 'A' : 'A');
            const dotColor = typeof s.index === 'number' ? colorForIndex(s.index) : undefined;
            return (
              <div key={s.id} className={`weui-msg ${isRight ? 'me' : ''} ${s.thinking ? 'thinking' : ''}`}>
                <div
                  className="avatar"
                  style={dotColor ? { background: dotColor } : undefined}
                  title={name}
                >
                  {initial}
                </div>
                <div className="bubble-wrap">
                  <div className="name">{name}</div>
                  <div className={`bubble ${s.thinking ? 'dim' : ''}`}>
                    {s.thinking ? (
                      s.text ? (
                        // 流式进行中：显示已到达的文本 + 闪烁光标
                        <>
                          <Markdown text={s.text} />
                          <span className="stream-caret" aria-hidden="true" />
                        </>
                      ) : (
                        <div className="typing">
                          <span /> <span /> <span />
                          <em>正在发言…</em>
                        </div>
                      )
                    ) : (
                      <Markdown text={s.text} />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="weui-composer">
          <textarea
            rows={2}
            value={human}
            onChange={(e) => setHuman(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                sendHuman();
              }
              if (e.key === 'Escape' && running) {
                e.preventDefault();
                stop();
              }
            }}
            placeholder={sessionId ? '插一句（Ctrl/⌘ + Enter 发送，Esc 停止对话）' : '对话开启后可发言'}
            disabled={!sessionId}
          />
          <div className="composer-actions">
            {running && (
              <button className="btn weui-btn weui-btn-warn" onClick={stop}>
                停止
              </button>
            )}
            <button
              className="btn weui-btn weui-btn-primary"
              onClick={sendHuman}
              disabled={!sessionId || !human.trim()}
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
