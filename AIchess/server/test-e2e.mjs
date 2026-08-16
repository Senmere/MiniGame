// 端到端测试: Socket.IO 启动 AvA 对局（走 20 步）+ Chat 对话室（1 轮）
// 前置: 后端 :4000 已启动且测试 DB 里有两个指向 mock 端点的模型
import { io } from 'socket.io-client';

const BASE = process.env.E2E_BASE ?? 'http://localhost:4000';
const events = [];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function connect() {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'], timeout: 5000 });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

async function main() {
  // ============ AvA 测试（先确保池里只有棋类模型，排除 Chat 长文本模型干扰） ============
  const modelRes = await fetch(`${BASE}/api/models`);
  const allModels = await modelRes.json();
  for (const m of allModels) {
    const isChess = String(m.model_name ?? '').includes('mock-chess');
    if (m.enabled !== isChess) {
      await fetch(`${BASE}/api/models/${m.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: isChess }),
      });
    }
  }

  console.log('== AvA: 启动对局 (seats=2, watcher=1, moveDelayMs=80) ==');
  const s = await connect();
  s.on('arena:event', (msg) => {
    events.push({ kind: 'arena', type: msg.event.type, ...msg.event });
  });

  s.emit('arena:start', { gameId: 'xiangqi', seats: 2, watcherCount: 1, moveDelayMs: 80 });

  // 收集事件直到 20 个 move 或超时
  const moves = [];
  let started = false;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline && moves.length < 20) {
    await delay(300);
    // 从 events 中解析
  }
  // 用轮询方式收集
  const poll = async () => {
    while (Date.now() < deadline && events.filter((e) => e.type === 'move').length < 20) {
      await delay(500);
    }
  };
  await poll();

  const arenaEvents = events.filter((e) => e.kind === 'arena');
  const moveEvents = arenaEvents.filter((e) => e.type === 'move');
  const illegalEvents = arenaEvents.filter((e) => e.type === 'illegal');
  const watcherEvents = arenaEvents.filter((e) => e.type === 'watcher');
  const overEvents = arenaEvents.filter((e) => e.type === 'over');

  console.log(`  move 事件: ${moveEvents.length}`);
  console.log(`  illegal 事件: ${illegalEvents.length}`);
  console.log(`  watcher 事件: ${watcherEvents.length}`);
  console.log(`  over 事件: ${overEvents.length}`);
  if (overEvents.length) console.log(`  终局: ${overEvents[0].reason} winner=${overEvents[0].winner}`);
  console.log(`  init 事件: ${arenaEvents.filter((e) => e.type === 'init').length}`);
  console.log(`  state 事件: ${arenaEvents.filter((e) => e.type === 'state').length}`);
  console.log(`  thinking 事件: ${arenaEvents.filter((e) => e.type === 'thinking').length}`);

  // 验证 move 事件字段
  if (moveEvents.length >= 5) {
    const m0 = moveEvents[0];
    console.log(`  首步: seat=${m0.seat} describe="${m0.describe}" viaTool=${m0.viaTool} tokensIn=${m0.tokensIn}`);
    const okFields = m0.seat !== undefined && m0.describe && Array.isArray(m0.action) && m0.action.length === 4 && typeof m0.tokensIn === 'number';
    console.log(`  首步字段完整: ${okFields ? 'PASS' : 'FAIL'}`);
  }

  // 验证 state 事件一致性: 最后一 state 的 halfMoves 应与 move 数一致
  const stateEvents = arenaEvents.filter((e) => e.type === 'state');
  if (stateEvents.length && moveEvents.length) {
    const lastState = stateEvents[stateEvents.length - 1];
    const halfMoves = lastState.state?.halfMoves;
    console.log(`  state.halfMoves=${halfMoves} vs move 数=${moveEvents.length} → ${halfMoves === moveEvents.length ? 'PASS' : 'FAIL'}`);
  }

  s.emit('arena:stop', {});
  await delay(300);
  s.disconnect();

  // ============ Chat 测试 ============
  console.log('\n== Chat: 启动对话室 (3 AI, 1 轮) ==');
  const s2 = await connect();
  const chatEvents = [];
  s2.on('chat:event', (msg) => chatEvents.push(msg.event));

  s2.emit('chat:start', { memberCount: 3, topic: '程序员会被 AI 取代吗？', maxRounds: 1, turnDelayMs: 100, thinking: false });

  const cDeadline = Date.now() + 30000;
  while (Date.now() < cDeadline && !chatEvents.some((e) => e.type === 'over')) {
    await delay(300);
  }

  const initE = chatEvents.find((e) => e.type === 'init');
  const msgs = chatEvents.filter((e) => e.type === 'message');
  const thinks = chatEvents.filter((e) => e.type === 'thinking');
  const overE = chatEvents.find((e) => e.type === 'over');
  const errE = chatEvents.find((e) => e.type === 'error');

  console.log(`  init 成员数: ${initE?.members?.length ?? 'N/A'} (期望 3) → ${initE?.members?.length === 3 ? 'PASS' : 'FAIL'}`);
  console.log(`  message 事件: ${msgs.length} (期望 3) → ${msgs.length === 3 ? 'PASS' : 'FAIL'}`);
  console.log(`  thinking 事件: ${thinks.length}`);
  console.log(`  over: ${overE?.reason ?? 'N/A'}`);
  if (errE) console.log(`  错误: ${errE.message}`);
  const okMsg = msgs.every((m) => typeof m.text === 'string' && m.text.length > 0 && typeof m.index === 'number');
  console.log(`  消息字段完整: ${okMsg ? 'PASS' : 'FAIL'}`);

  s2.disconnect();
  console.log('\n========== E2E 完成 ==========');
  process.exit(0);
}

main().catch((e) => {
  console.error('E2E 失败:', e);
  process.exit(1);
});
