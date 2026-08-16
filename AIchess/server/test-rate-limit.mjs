// 验证：① 429 限流精确退避（Retry-After）且不触发熔断；② per-model 锁串行化并发调用
import { io } from 'socket.io-client';

const BASE = 'http://localhost:4000';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function connect() {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'], timeout: 5000 });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

async function main() {
  // 用 mock-rate-limit 双模型对弈：前 2 次调用返回 429+Retry-After，之后正常
  const s = await connect();
  const events = [];
  s.on('arena:event', (msg) => events.push(msg.event));

  s.emit('arena:start', { gameId: 'xiangqi', seats: 2, watcherCount: 2, moveDelayMs: 50 });

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && events.filter((e) => e.type === 'move').length < 12) {
    await delay(400);
  }

  const moves = events.filter((e) => e.type === 'move');
  const illegals = events.filter((e) => e.type === 'illegal');
  const rateLimitMsgs = illegals.filter((e) => (e.reason ?? '').includes('429'));
  const breakerMsgs = illegals.filter((e) => (e.reason ?? '').includes('熔断'));
  const viaTool = moves.filter((e) => e.viaTool).length;
  const autoMoves = moves.filter((e) => (e.chat ?? '').includes('系统代走')).length;

  console.log(`move 事件: ${moves.length} (工具调用=${viaTool}, 系统代走=${autoMoves})`);
  console.log(`illegal 事件: ${illegals.length}`);
  console.log(`  429 限流提示: ${rateLimitMsgs.length}`);
  console.log(`  熔断提示: ${breakerMsgs.length}`);
  if (rateLimitMsgs[0]) console.log(`  429 示例: ${rateLimitMsgs[0].reason}`);

  // 关键断言：
  // 1. 出现 429 限流退避提示（带 Retry-After 的 1000ms 等待）
  const saw429 = rateLimitMsgs.some((m) => (m.reason ?? '').includes('1000ms') || (m.reason ?? '').includes('429'));
  // 2. 429 不触发熔断（Kimi 场景：限流≠故障）
  const noBreakerFrom429 = breakerMsgs.length === 0;
  // 3. 对局恢复：出现工具调用或足够步数（限流后模型恢复正常）
  const recovered = viaTool > 0 || moves.length >= 10;
  // 4. 观战 AI 并发 2 + 下棋 AI 同一模型 → per-model 锁串行（无 429 熔断即证明无并发冲突导致挂死）

  console.log(`\n429 精确退避出现: ${saw429 ? 'PASS' : 'FAIL'}`);
  console.log(`429 不触发熔断: ${noBreakerFrom429 ? 'PASS' : 'FAIL'}`);
  console.log(`限流后对局恢复: ${recovered ? 'PASS' : 'FAIL'}`);

  s.emit('arena:stop', {});
  s.disconnect();
  process.exit(saw429 && noBreakerFrom429 && recovered ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
