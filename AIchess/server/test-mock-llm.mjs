// 模拟 OpenAI 兼容 /chat/completions 端点，用于端到端测试 AvA/Chat 流程
// 支持: stream:true（SSE 分块）与非流式；模型行为可通过 model_name 切换:
//   mock-chess-a/b  → 工具调用（下棋）
//   mock-plaintext  → 无视 tools 直接输出文本 JSON
//   mock-garbage    → 输出无法解析的乱码文本
//   mock-chat-*     → Chat 流式长文本
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 4199);
let callCount = 0;
const calls = [];
const flakyCount = new Map(); // mock-flaky 的失败次数计数
const rateLimitCount = new Map(); // mock-rate-limit 的 429 次数计数

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/chat/completions') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      callCount++;
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = {};
      }
      const msgs = parsed.messages ?? [];
      const userMsg = msgs.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
      const sysMsg = msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
      calls.push({ model: parsed.model, stream: !!parsed.stream, hasTools: !!parsed.tools?.length, toolChoice: !!parsed.tool_choice, thinking: parsed.thinking ?? null, temperature: parsed.temperature ?? 'default', userHead: userMsg.slice(0, 80) });

      // 从 user 消息提取合法着法编号列表: 匹配 [N] 描述 raw=[a,b,c,d]
      const legal = [];
      const re = /\[(\d+)\]\s+[^\n]*?raw=\[(\d+),(\d+),(\d+),(\d+)\]/g;
      let m;
      while ((m = re.exec(userMsg)) !== null) {
        legal.push({ choice: Number(m[1]), fr: +m[2], fc: +m[3], tr: +m[4], tc: +m[5] });
      }

      const usage = { prompt_tokens: 1200 + Math.floor(Math.random() * 500), completion_tokens: 60 };

      // ============ 模型行为分支（非流式先算出完整回复） ============
      let reply = null; // { content?: string|null, toolCalls?: [...] }

      // 0) 永远 500 的坏模型：验证熔断器 + 瞬时错误退避
      if (parsed.model === 'mock-down') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'mock server error (simulated outage)' } }));
        return;
      }
      // 0.5) 前 N 次 500、之后正常：验证退避后恢复
      if (parsed.model === 'mock-flaky') {
        const flaky = flakyCount.get('mock-flaky') ?? 0;
        flakyCount.set('mock-flaky', flaky + 1);
        if (flaky < 3) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: `transient failure #${flaky + 1}` } }));
          return;
        }
      }
      // 0.7) 首次 429 + Retry-After 头，之后正常：验证 429 精确退避且不熔断
      if (parsed.model === 'mock-rate-limit') {
        const n = rateLimitCount.get('mock-rate-limit') ?? 0;
        rateLimitCount.set('mock-rate-limit', n + 1);
        if (n < 2) {
          res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '1' });
          res.end(JSON.stringify({ error: { message: 'rate limited, retry after 1s' } }));
          return;
        }
      }

      // 1) Chat 对话模型: 返回一段带空行的长文本（流式分块验证打字机）
      if (parsed.model.startsWith('mock-chat')) {
        const topic = (msgs.find((x) => x.role === 'system')?.content ?? '').match(/讨论话题: (.+)/)?.[1] ?? '这个话题';
        reply = {
          content:
            `关于「${topic}」我有几点看法。\n\n` +
            `首先，这是一个值得深入讨论的问题。\n\n` +
            `其次，从工程实践的角度看，我们需要权衡短期收益与长期成本。\n\n` +
            `最后，我建议保持开放心态，多参考实际案例。\n\n` +
            `以上就是我的观点，欢迎大家补充讨论。`,
        };
      }
      // 2) 无视 tools 的模型
      else if (parsed.model === 'mock-plaintext') {
        const pick = legal.length > 0 ? legal[Math.floor(Math.random() * legal.length)] : { choice: 0 };
        reply = { content: JSON.stringify({ choice: pick.choice, chat: '纯文本模式落子。' }) };
      }
      // 3) 乱码模型
      else if (parsed.model === 'mock-garbage') {
        reply = { content: '我思考了一下，这步棋走这里比较合适，你觉得呢？' };
      }
      // 4) 观战 AI
      else if (sysMsg.includes('观战')) {
        reply = { content: '这一步走得不错，局势逐渐明朗。' };
      }
      // 5) 下棋 AI: 返回 make_move 工具调用
      else if (legal.length > 0) {
        // 无 tools 请求（如 Chat 场景抽到棋类模型）→ 返回普通聊天文本
        if (!parsed.tools?.length) {
          reply = { content: '我同意你的观点，这个话题很有价值，我们可以继续深入探讨。' };
        } else {
          const pick = legal[Math.floor(Math.random() * legal.length)];
          const chat = pick.choice % 2 === 0 ? '我来走这一步。' : '思考中，落子。';
          reply = {
            content: null,
            toolCalls: [
              {
                id: 'call_mock_1',
                type: 'function',
                function: { name: 'make_move', arguments: JSON.stringify({ choice: pick.choice, chat }) },
              },
            ],
          };
        }
      }
      // 6) 兜底: 文本 JSON
      else {
        reply = { content: JSON.stringify({ choice: 0, chat: '没有合法着法' }) };
      }

      // ============ 输出（流式 / 非流式） ============
      if (parsed.stream) {
        sendStream(res, reply, usage);
      } else {
        const out = {
          choices: [
            {
              message: reply.toolCalls
                ? { content: reply.content ?? null, tool_calls: reply.toolCalls }
                : { content: reply.content ?? null },
              finish_reason: reply.toolCalls ? 'tool_calls' : 'stop',
            },
          ],
          usage,
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      }
    });
    return;
  }
  // 健康检查
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
});

/** SSE 分块输出：内容逐字（小批）输出，模拟打字机 */
function sendStream(res, reply, usage) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const flush = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  if (reply.toolCalls) {
    // 工具调用流式：分两段输出 arguments（不用于 AvA，但保持协议完整）
    const tc = reply.toolCalls[0];
    const args = tc.function.arguments;
    const mid = Math.ceil(args.length / 2);
    flush({
      choices: [{ delta: { tool_calls: [{ index: 0, id: tc.id, type: 'function', function: { name: tc.function.name, arguments: args.slice(0, mid) } }] } }],
    });
    setTimeout(() => {
      flush({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(mid) } }] } }] });
      finish();
    }, 30);
    return;
  }

  const text = reply.content ?? '';
  // 把文本切成小片段（按 6 字符一批），带 40ms 间隔，模拟打字机
  const CHUNK = 6;
  const DELAY = 40;
  let i = 0;
  const timer = setInterval(() => {
    if (i >= text.length) {
      clearInterval(timer);
      finish();
      return;
    }
    const piece = text.slice(i, i + CHUNK);
    i += CHUNK;
    flush({ choices: [{ delta: { content: piece } }] });
  }, DELAY);

  function finish() {
    flush({ choices: [{ delta: {}, finish_reason: 'stop' }], usage });
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

server.listen(PORT, () => {
  console.log(`[mock-llm] listening on :${PORT} (stream supported)`);
});

process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
