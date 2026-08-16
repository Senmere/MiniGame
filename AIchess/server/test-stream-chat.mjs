// 流式 Chat 端到端验证：应看到 thinking → 多个 delta → message → over
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
  s.on('chat:event', (msg) => events.push(msg.event));

  s.emit('chat:start', { memberCount: 2, topic: '程序员会被 AI 取代吗？', maxRounds: 1, turnDelayMs: 50, thinking: false });

  const deadline = Date.now() + 40000;
  while (Date.now() < deadline && !events.some((e) => e.type === 'over')) {
    await delay(200);
  }

  const initE = events.find((e) => e.type === 'init');
  const thinks = events.filter((e) => e.type === 'thinking');
  const deltas = events.filter((e) => e.type === 'delta');
  const msgs = events.filter((e) => e.type === 'message');
  const overE = events.find((e) => e.type === 'over');
  const errE = events.find((e) => e.type === 'error');

  console.log(`init 成员数: ${initE?.members?.length} (期望 2)`);
  console.log(`thinking 事件: ${thinks.length} (期望 2)`);
  console.log(`delta 事件: ${deltas.length} (期望 >> 2，流式分块)`);
  console.log(`message 事件: ${msgs.length} (期望 2)`);
  console.log(`over: ${overE?.reason}`);

  // 验证: 每个 AI 的 delta 拼接 ≈ message 全文
  for (let i = 0; i < 2; i++) {
    const joined = deltas.filter((d) => d.index === i).map((d) => d.delta).join('');
    const final = msgs.find((m) => m.index === i)?.text ?? '';
    console.log(`AI#${i}: delta拼接长度=${joined.length}, message长度=${final.length}, 一致=${joined === final ? 'PASS' : 'FAIL'}`);
  }

  // 验证 delta 顺序: 每个 index 的 delta 依次到达且不空
  const perIndex = [0, 1].map((i) => deltas.filter((d) => d.index === i).map((d) => d.delta));
  const allOk = perIndex.every((arr) => arr.length > 3 && arr.every((d) => d.length > 0));
  console.log(`每个 AI 至少 4 个非空 delta: ${allOk ? 'PASS' : 'FAIL'}`);

  if (errE) console.log(`错误: ${errE.message}`);
  s.disconnect();
  process.exit(errE ? 1 : 0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
