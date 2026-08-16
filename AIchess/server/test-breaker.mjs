// 熔断器验证：两个 mock-down 模型（永远 500）
// 预期：每步 3 次瞬时错误重试（指数退避）→ 熔断冷却 → 系统代走，对局持续不中断
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
  const s = await connect();
  const events = [];
  s.on('arena:event', (msg) => events.push(msg.event));

  s.emit('arena:start', { gameId: 'xiangqi', seats: 2, watcherCount: 0, moveDelayMs: 50 });

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline && events.filter((e) => e.type === 'move').length < 15) {
    await delay(400);
  }

  const moves = events.filter((e) => e.type === 'move');
  const illegals = events.filter((e) => e.type === 'illegal');
  const breakerMsgs = illegals.filter((e) => (e.reason ?? '').includes('熔断'));
  const backoffMsgs = illegals.filter((e) => (e.reason ?? '').includes('瞬时错误'));
  const autoMoves = moves.filter((e) => (e.chat ?? '').includes('系统代走'));

  console.log(`move 事件: ${moves.length}`);
  console.log(`  其中系统代走: ${autoMoves.length}`);
  console.log(`illegal 事件: ${illegals.length}`);
  console.log(`  瞬时错误退避: ${backoffMsgs.length}`);
  console.log(`  熔断冷却提示: ${breakerMsgs.length}`);
  if (backoffMsgs[0]) console.log(`  退避示例: ${backoffMsgs[0].reason}`);
  if (breakerMsgs[0]) console.log(`  熔断示例: ${breakerMsgs[0].reason}`);

  const gameAlive = moves.length >= 10; // 对局持续了至少 10 步（未中断判负）
  const sawBreaker = breakerMsgs.length > 0;
  const sawBackoff = backoffMsgs.length > 0;
  console.log(`\n对局持续 >=10 步: ${gameAlive ? 'PASS' : 'FAIL'}`);
  console.log(`触发指数退避: ${sawBackoff ? 'PASS' : 'FAIL'}`);
  console.log(`触发熔断冷却: ${sawBreaker ? 'PASS' : 'FAIL'}`);

  s.emit('arena:stop', {});
  s.disconnect();
  process.exit(gameAlive && sawBackoff && sawBreaker ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
