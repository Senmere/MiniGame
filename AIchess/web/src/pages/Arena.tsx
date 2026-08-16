import { useEffect, useRef, useState } from 'react';
import { api, type GameInfo } from '../api/client.js';
import { socket } from '../socket.js';
import XiangqiBoard, { type XiangqiState } from '../components/XiangqiBoard.js';

interface SeatInfo { seatIndex: number; model: string; sideLabel: string; }
interface LogItem {
  id: number;
  cls: 'move' | 'watcher' | 'human' | 'illegal' | 'info' | 'chat';
  who: string;
  text: string;
  conf?: number;
}

interface ArenaEvent {
  sessionId: string;
  event: Record<string, any>;
}

export default function Arena() {
  const [games, setGames] = useState<GameInfo[]>([]);
  const [gameId, setGameId] = useState('xiangqi');
  const [seats, setSeats] = useState(2);
  const [watcherCount, setWatcherCount] = useState(1);
  const [moveDelayMs, setMoveDelayMs] = useState(800);
  const [state, setState] = useState<XiangqiState | null>(null);
  const [seatModels, setSeatModels] = useState<SeatInfo[]>([]);
  const [watchers, setWatchers] = useState<string[]>([]);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [last, setLast] = useState<{ from: [number, number]; to: [number, number] } | null>(null);
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState('');
  const [human, setHuman] = useState('');
  const [sessionId, setSessionId] = useState('');
  const counter = useRef(0);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listGames().then((g) => { setGames(g); if (g[0]) setGameId(g[0].id); }).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (msg: ArenaEvent) => {
      const e = msg.event;
      const push = (item: Omit<LogItem, 'id'>) => {
        counter.current += 1;
        setLogs((l) => [...l.slice(-200), { ...item, id: counter.current }]);
      };
      switch (e.type) {
        case 'init': {
          const ss: SeatInfo[] = e.seats.map((s: any) => ({ seatIndex: s.seatIndex, model: s.model.model_name, sideLabel: s.sideLabel }));
          setSeatModels(ss);
          setWatchers(e.watchers.map((w: any) => w.model_name));
          setState(e.state);
          push({ cls: 'info', who: '系统', text: `对局开始：${ss.map((s) => `${s.sideLabel}=${s.model}`).join(' vs ')}` });
          if (e.watchers.length) push({ cls: 'info', who: '系统', text: `观战 AI：${e.watchers.map((w: any) => w.model_name).join('、')}` });
          break;
        }
        case 'state':
          setState(e.state);
          break;
        case 'thinking':
          push({ cls: 'info', who: seatModels[e.seat]?.sideLabel ?? `#${e.seat}`, text: `${e.model} 思考中…` });
          break;
        case 'move': {
          const side = seatModels[e.seat]?.sideLabel ?? `#${e.seat}`;
          const model = e.model ?? seatModels[e.seat]?.model ?? '';
          const act = e.action as number[];
          setLast({ from: [act[0], act[1]], to: [act[2], act[3]] });
          push({ cls: 'move', who: `${side} · ${model}`, text: `${e.describe}${e.chat ? '  💬 ' + e.chat : ''}` });
          break;
        }
        case 'watcher':
          push({ cls: 'watcher', who: `观战 #${e.index} · ${e.model}`, text: e.text, conf: e.confidence });
          break;
        case 'illegal':
          push({ cls: 'illegal', who: seatModels[e.seat]?.sideLabel ?? `#${e.seat}`, text: `非法着法：${e.reason}（原始：${JSON.stringify(e.raw)}）` });
          break;
        case 'human':
          push({ cls: 'human', who: '玩家', text: e.text });
          break;
        case 'over':
          setOver(e.reason);
          setRunning(false);
          push({ cls: 'info', who: '终局', text: `胜者：${e.winner === null ? '平局' : seatModels[e.winner]?.sideLabel ?? `座位${e.winner}`} —— ${e.reason}` });
          break;
        case 'error':
          push({ cls: 'illegal', who: '错误', text: e.message });
          setRunning(false);
          break;
      }
    };
    socket.on('arena:event', handler);
    socket.on('arena:started', (d: { sessionId: string }) => setSessionId(d.sessionId));
    return () => {
      socket.off('arena:event', handler);
      socket.off('arena:started');
    };
  }, [seatModels]);

  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [logs]);

  const start = () => {
    setLogs([]); setOver(''); setLast(null); setRunning(true);
    setState(null);
    socket.emit('arena:start', { gameId, seats, watcherCount, moveDelayMs });
  };

  const stop = () => {
    if (sessionId) socket.emit('arena:stop', { sessionId });
    setRunning(false);
  };

  const sendHuman = () => {
    if (!human.trim() || !sessionId) return;
    socket.emit('arena:human', { sessionId, text: human.trim() });
    setHuman('');
  };

  return (
    <div>
      <h1>AvA 竞技场 · AI vs AI</h1>
      <p className="sub">多个 AI 自主对弈，玩家观战。AI 输出结构化动作编码由系统直接解析执行，自然语言仅作辅助。</p>

      <div className="card">
        <div className="row">
          <label>游戏
            <select value={gameId} onChange={(e) => setGameId(e.target.value)} disabled={running}>
              {games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              {games.length === 0 && <option value="xiangqi">中国象棋</option>}
            </select>
          </label>
          <label>AI 数量
            <input type="number" min={2} max={2} value={seats} disabled={running} onChange={(e) => setSeats(Number(e.target.value))} />
          </label>
          <label>观战 AI 数量
            <input type="number" min={0} max={6} value={watcherCount} disabled={running} onChange={(e) => setWatcherCount(Number(e.target.value))} />
          </label>
          <label>走子间隔
            <select value={String(moveDelayMs)} disabled={running} onChange={(e) => setMoveDelayMs(Number(e.target.value))}>
              <option value="400">快(0.4s)</option>
              <option value="800">正常(0.8s)</option>
              <option value="1500">慢(1.5s)</option>
              <option value="3000">很慢(3s)</option>
            </select>
          </label>
          {!running ? (
            <button onClick={start}>开始对局</button>
          ) : (
            <button className="danger" onClick={stop}>停止</button>
          )}
        </div>
      </div>

      <div className="grid-arena">
        <div className="card">
          <h2>棋盘</h2>
          <XiangqiBoard state={state} lastFrom={last?.from ?? null} lastTo={last?.to ?? null} />
          <div className="row" style={{ marginTop: 14, justifyContent: 'center' }}>
            <span className="muted">回合 #{state?.halfMoves ?? 0}</span>
            <span className="tag">{state?.turn === 'r' ? '红方行棋' : state?.turn === 'b' ? '黑方行棋' : '等待'}</span>
            {over && <span className="tag" style={{ color: 'var(--green)' }}>{over}</span>}
          </div>
        </div>

        <div className="card">
          <h2>实时消息流</h2>
          <div className="chat-stream" ref={streamRef}>
            {logs.length === 0 && <div className="muted small">点击「开始对局」生成 AI 模型池抽样并启动…</div>}
            {logs.map((l) => (
              <div key={l.id} className={`msg ${l.cls}`}>
                <div className="who">{l.who}{l.conf !== undefined && <span className="conf">置信度 {(l.conf * 100).toFixed(0)}%</span>}</div>
                <div>{l.text}</div>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <input
              value={human}
              onChange={(e) => setHuman(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendHuman()}
              placeholder={sessionId ? '发送观战弹幕…（以低置信度注入 AI 上下文）' : '对局开始后可发言'}
              disabled={!sessionId}
            />
            <button onClick={sendHuman} disabled={!sessionId}>发送</button>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>座位与模型</h2>
        <table>
          <thead><tr><th>座位</th><th>阵营</th><th>模型</th></tr></thead>
          <tbody>
            {seatModels.map((s) => (
              <tr key={s.seatIndex}><td>#{s.seatIndex}</td><td>{s.sideLabel}</td><td><span className="badge">{s.model}</span></td></tr>
            ))}
            {seatModels.length === 0 && <tr><td colSpan={3} className="muted">尚未分配</td></tr>}
          </tbody>
        </table>
        {watchers.length > 0 && <p className="small muted" style={{ marginTop: 10 }}>观战 AI：{watchers.join('、')}</p>}
      </div>
    </div>
  );
}
