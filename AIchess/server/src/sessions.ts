import type { Server as IOServer, Socket } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { ArenaRunner } from './arena/runner.js';
import { ChatRoom } from './chat/room.js';
import { getSetting } from './db/index.js';

interface RuntimeOpts {
  watcherConfidenceRange?: [number, number];
  watcherEvery?: number;
  moveDelayMs?: number;
  chatThinkingDefault?: boolean;
  chatTurnDelayMs?: number;
}

function readRuntime(): RuntimeOpts {
  try {
    return JSON.parse(getSetting('runtime', '{}'));
  } catch {
    return {};
  }
}

interface ArenaSession {
  sessionId: string;
  runner: ArenaRunner;
  socketId: string;
}
interface ChatSession {
  sessionId: string;
  room: ChatRoom;
  socketId: string;
}

const arenaSessions = new Map<string, ArenaSession>();
const chatSessions = new Map<string, ChatSession>();

/** 停止并移除会话（终局/停止/断线共用） */
function stopArena(sessionId: string): void {
  const s = arenaSessions.get(sessionId);
  if (s) {
    s.runner.stop();
    arenaSessions.delete(sessionId);
  }
}
function stopChat(sessionId: string): void {
  const s = chatSessions.get(sessionId);
  if (s) {
    s.room.stop();
    chatSessions.delete(sessionId);
  }
}

export function attachSocket(io: IOServer): void {
  io.on('connection', (socket: Socket) => {
    socket.emit('hello', { id: socket.id });

    // 断线时停止该连接名下所有会话（避免 runner/room 继续调用付费 LLM 与内存泄漏）
    socket.on('disconnect', () => {
      for (const [sid, s] of arenaSessions) if (s.socketId === socket.id) stopArena(sid);
      for (const [sid, s] of chatSessions) if (s.socketId === socket.id) stopChat(sid);
    });

    // ============== AvA 竞技场 ==============
    socket.on(
      'arena:start',
      (payload: { gameId: string; seats: number; watcherCount: number; moveDelayMs?: number }) => {
        const sessionId = randomUUID();
        const opts = readRuntime();
        const runner = new ArenaRunner({
          gameId: payload.gameId,
          seats: payload.seats,
          watcherCount: payload.watcherCount ?? 0,
          sessionId,
          emit: (e) => socket.emit('arena:event', { sessionId, event: e }),
          // 前端每次可指定走子间隔；未传时回退到全局设置，再回退默认 400ms
          moveDelayMs: payload.moveDelayMs ?? opts.moveDelayMs ?? 400,
          watcherEvery: opts.watcherEvery ?? 2,
          watcherConfidenceRange: opts.watcherConfidenceRange ?? [-0.2, -0.1],
        });
        arenaSessions.set(sessionId, { sessionId, runner, socketId: socket.id });
        socket.emit('arena:started', { sessionId });
        runner
          .start()
          .catch((err) => {
            socket.emit('arena:event', {
              sessionId,
              event: { type: 'error', message: (err as Error).message },
            });
          })
          .finally(() => {
            // 对局自然结束（over）后从内存移除，避免泄漏
            if (arenaSessions.get(sessionId)?.runner === runner) arenaSessions.delete(sessionId);
          });
      },
    );

    socket.on('arena:human', (payload: { sessionId: string; text: string }) => {
      const s = arenaSessions.get(payload.sessionId);
      if (s) s.runner.pushHumanText(payload.text);
    });

    socket.on('arena:stop', (payload: { sessionId: string }) => stopArena(payload.sessionId));

    // ============== Chat 模式 ==============
    socket.on(
      'chat:start',
      (
        payload: {
          memberCount: number;
          topic?: string;
          injectHumanContext?: boolean;
          maxRounds?: number;
          thinking?: boolean;
          maxTokens?: number;
          turnDelayMs?: number;
        },
      ) => {
        const sessionId = randomUUID();
        const runtime = readRuntime();
        const thinkingDefault =
          typeof runtime.chatThinkingDefault === 'boolean' ? runtime.chatThinkingDefault : false;
        const room = new ChatRoom({
          memberCount: payload.memberCount,
          topic: payload.topic,
          injectHumanContext: payload.injectHumanContext ?? true,
          maxRounds: payload.maxRounds ?? 40,
          thinking: payload.thinking ?? thinkingDefault,
          maxTokens: payload.maxTokens,
          turnDelayMs: payload.turnDelayMs ?? runtime.chatTurnDelayMs ?? 900,
          sessionId,
          emit: (e) => socket.emit('chat:event', { sessionId, event: e }),
        });
        chatSessions.set(sessionId, { sessionId, room, socketId: socket.id });
        socket.emit('chat:started', { sessionId });
        room
          .start()
          .catch((err) => {
            socket.emit('chat:event', {
              sessionId,
              event: { type: 'error', message: (err as Error).message },
            });
          })
          .finally(() => {
            if (chatSessions.get(sessionId)?.room === room) chatSessions.delete(sessionId);
          });
      },
    );

    socket.on('chat:human', (payload: { sessionId: string; text: string }) => {
      const s = chatSessions.get(payload.sessionId);
      if (s) void s.room.pushHumanText(payload.text);
    });

    socket.on('chat:stop', (payload: { sessionId: string }) => stopChat(payload.sessionId));
  });
}
