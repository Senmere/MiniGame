// 验证「模型无视 tools 返回纯文本」时自动降级到文本 JSON 的路径
// 前置: mock-plaintext 模型已加入池，且池中只有它 + 两个正常 mock 模型
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

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && events.filter((e) => e.type === 'move').length < 30) {
    await delay(400);
  }

  const moves = events.filter((e) => e.type === 'move');
  const illegals = events.filter((e) => e.type === 'illegal');
  const fallbackMsgs = illegals.filter((e) => (e.reason ?? '').includes('文本JSON回退'));
  const viaToolMoves = moves.filter((e) => e.viaTool);
  const viaTextMoves = moves.filter((e) => !e.viaTool);

  console.log(`move 事件: ${moves.length}`);
  console.log(`  viaTool(工具调用): ${viaToolMoves.length}`);
  console.log(`  非工具(文本JSON/代走): ${viaTextMoves.length}`);
  console.log(`illegal 事件: ${illegals.length}`);
  console.log(`  其中降级到文本JSON: ${fallbackMsgs.length}`);
  illegals.slice(0, 8).forEach((e) => console.log(`    - ${e.reason}`));

  // 关键断言: 只要池里含 mock-plaintext，就应观察到至少一次「模型未返回工具调用，切换文本JSON回退」
  const sawFallback = fallbackMsgs.some((m) => m.reason.includes('模型未返回工具调用'));
  const plaintextWorks = viaTextMoves.length > 0 || sawFallback;
  console.log(`\n看到纯文本降级: ${sawFallback ? 'YES' : 'NO'}`);
  console.log(`文本 JSON 路径生效: ${plaintextWorks ? 'PASS' : 'FAIL'}`);

  s.emit('arena:stop', {});
  s.disconnect();
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
