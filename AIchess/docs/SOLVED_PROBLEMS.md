# 已解决问题与踩坑清单（SOLVED_PROBLEMS）

本文档记录项目开发过程中遇到的**实际报错、现象、排查思路、最终修复方案**，供后续同类问题快速检索。全部条目可在 git 历史或对应文件的注释里找到原始提交。

---

## 1. 模型兼容性类

### 1.1 kimi-k2.5 拒绝 temperature=0.7

- **现象**：Chat 对话室 kimi-k2.5 一到真发消息就报错
  ```
  错误：模型调用失败 400: {
    "error":{"message":"invalid temperature: only 1 is allowed for this model","type":"invalid_request_error"}
  }
  ```
- **根因**：`server/src/modelPool/provider.ts` 以前写了 `temperature: opts.temperature ?? 0.7`，**默认硬塞 0.7**，哪怕调用方没传，也会被 kimi 等只允许 temperature=1 的厂商拒掉。
- **修复**：
  - `provider.ts callModel`：只有 `opts.temperature !== undefined` 才往 body 里放 temperature；完全不传，让各家服务端走自己的默认值（`provider.ts#L77-L83`）。
  - `chat/room.ts`：`const temperature = this.cfg.temperature;` 不再 `?? 0.9` 默认硬填，让 undefined 通过去触发上述分支（`room.ts#L79`）。
- **启示**：OpenAI 兼容接口的"可选数值字段"宁可不传，也不要写一个看起来"合理"的默认值——不同厂商合法值域差异很大。

### 1.2 DeepSeek strict 工具调用 404

- **现象**：AvA 开赛后 deepseek 模型直接 404 或 `invalid_request_error`，`strict: true` 工具调用失败。
- **根因**：DeepSeek strict mode 工具调用不挂在 `/chat/completions`，要挂在 `/beta/chat/completions`。
- **修复**：`provider.ts buildEndpointUrl(base, tools)`：如果 `tools.some(t => t.function.strict)` 并且 base 是 `api.deepseek.com` 且还没以 `/beta` 结尾，就拼成 `{base}/beta/chat/completions`（`provider.ts buildEndpointUrl` 函数）。
- **启示**：别假设 OpenAI 兼容协议在各厂商端的路径一致，尤其是 beta 特性。

### 1.3 模型不支持 tools/tool_choice

- **现象**：`红方 非法着法：模型不支持工具调用，切换文本JSON回退`，重试 3 次后系统代走。
- **根因**：部分开源模型（Ollama qwen2.5、通义千问低配版、Kimi 旧版）完全不理会 `tools` / `tool_choice` 参数，要么直接 400，要么无视参数生成普通文本。
- **修复**：`ArenaRunner` 设计三级降级：
  1. strict 工具调用（`XIANQI_TOOL strict:true`）
  2. 失败 → 去 strict，仅 `tool_choice: { type: 'function', function: { name: 'make_move' } }` 再试一次
  3. 失败 → **文本 JSON 回退**：把 `system prompt` 里明确要求输出 `{"choice":N,"chat":"..."}`，并且 `extractJson` 去解析，lenient 化
- **启示**：不要依赖一种协议；降级链一定要明确，且每一级 failure 都要打到聊天事件里，方便前端显示"正在切换策略"。

### 1.4 开 thinking 后响应空（finish_reason=length）

- **现象**：Chat 对话室偶尔出现 `AI#0 返回空内容，已跳过本轮`，后端日志打印 `finish_reason: 'length'`，`content: ''`。
- **根因**：开启 thinking 后，token 分两段使用：内部思考过程消耗 tokens + 最终内容 tokens。如果 `max_tokens=300` 很小，思考全吃光，留给最终输出的就没了，或者刚好卡 length 截断导致输出空 JSON。
- **修复**：
  - `chat/room.ts`：开 thinking 时默认 maxTokens=1500，关 thinking 时默认 500（`room.ts#L81`）
  - AvA 下棋全部**关 thinking**（`thinking: 'disabled'`），棋盘推理靠思维链没意义，反而容易空响应
- **启示**：凡是要开 thinking 字段，max_tokens 至少是不开的 2~3 倍。

---

## 2. LLM 输出解析类

### 2.1 AI 输出无法解析为 JSON（单引号、尾逗号、无引号 key、注释）

- **现象**：AvA 文本 JSON 回退阶段常见
  ```
  红方 非法着法：Expected double-quoted property name in JSON at position 13 (line 1 column 14)(第1次)（原始：null）
  红方 非法着法：Expected double-quoted property name in JSON at position 13 (line 1 column 14)(第2次)（原始：null）
  红方 非法着法：Expected double-quoted property name in JSON at position 13 (line 1 column 14)(第3次)
  ```
- **根因**：
  1. DeepSeek JSON Mode 要求 `system` prompt 里明确出现 **json** 字样，并且参数里同时给了 `thinking: enabled`、`max_tokens` 太小，导致模型**输出全空**或截断
  2. LLM 偶发"JS 对象字面量"风格输出：`{choice:1, chat: '炮二平五'}`，自带单引号、无引号 key、尾逗号
- **修复**：
  1. 文本回退路径**去掉** `response_format: {type:'json_object'}`，因为 JSON Mode 对"必须出现 json 字样"敏感 + 容易空输出；改为用 `extractJson(text)` 从整段文本里挖 JSON（先找最外层 `{}`，再 parse，再 lenient 化）
  2. 新增 `lenientJsonify(s)`：
     - 去 `//` 行注释和 `/* */` 块注释
     - 去数组 / 对象尾逗号
     - 用一个 token-by-token 的小自动机把**单引号字符串转双引号**，并转义内部未转义的 `"`
     - 用正则给 unquoted key 补双引号：`{choice:1}` → `{"choice":1}`
     - 以上步骤全部做字符串替换而不是语法解析，对"只有一点点格式问题的 JSON"容错极高
- **文件**：`provider.ts lenientJsonify / extractJson` 函数

### 2.2 非法动作映射到合法着法后聊天文本仍说"吃马"，但实际吃的是别的子

- **现象**：
  ```
  红方 非法着法：炮(2,1)→(9,1)吃马（炮架不对）
  红方 炮(2,1)→(8,1)走 💬 炮打黑炮
  黑方 · 炮(2,7)→(2,5)走 💬 【系统代走】模型连续输出非法着法
  ```
  此时聊天写着"炮打黑炮"，但实际动作是系统代走的，动作和聊天**错位**。
- **根因**：代走时我们用了 `describeAction(state, A[i])`（真实着法）覆盖动作描述，但没有同时清空 chat 字段，导致动作和模型原本的 chat 不一致。
- **修复**：
  - `ArenaRunner.resolveAction`：如果走到系统代走分支（用尽重试），`chat` 字段强制固定为 `【系统代走】模型连续输出非法着法` 而不是保留模型原始 chat
  - `move` 事件同时发两个字段：`describe`（真实着法，来自 `describeAction`）和 `chat`（模型说的话）。前端可以把二者并排渲染，错位可见化，用户一眼知道"AI 没说对动作但系统代走了"
- **启示**：动作描述（describe）来自**系统执行后的真实动作**，而聊天文本（chat）是模型的"内心话"，两者必须独立存储、独立渲染，绝不要用聊天去描述真实发生了什么。

---

## 3. 规则/编码范式演进

### 3.1 "AI 直接输出坐标四元组" → 规则性非法着法满天飞

- **现象**：早期 AvA 工具 schema 是 `action: [number,number,number,number]`，让 AI 自己输出 `[7,1,7,8]`。炮隔子不隔子乱走、蹩马腿不懂、相不过河——都来了。典型：`炮(2,1)→(9,1)吃马`（中间没炮架却被 AI 说"吃马"）。
- **排查结论**：LLM 作为 next-token predictor，它能输出"看起来像坐标的东西"，但没法保证这坐标符合**离散规则约束**（炮架、蹩马腿、相眼、将帅对脸、棋子归属、是否出九宫…）。这是 LLM 范式天生短板，不是 prompt 能修好的。
- **行业调研**：微软 AutoGen Chess Sample、IBM Granite Chess Tutorial、pi-chess 等项目的通用做法 —— **Constrain the Output Space（限制输出空间）**。思路：
  1. 系统规则机先枚举全部合法着法 `A[0..N-1]`
  2. 把编号列表喂给 AI（prompt 里每条 `[15] 炮(7,1)→(5,1)走 raw=[7,1,5,1]`）
  3. AI 只输出 choice 编号；超出范围的 choice 仍然是错误，但"规则性非法"的概率从 80%+ 跌到 0%
- **修复**：
  - `games/xiangqi/prompt.ts` 的 `XIANGQI_TOOL` 把参数从 `action` 改成 `choice: integer`，schema 里写清楚"≥0 且 < 合法着法编号列表长度"（strict 模式需要带 `description` 字段）
  - `buildXiangqiPrompt(state, legalActions, history)` 注入编号列表
  - `arena/runner.ts ArenaRunner.buildCallSpec` 返回 `legalActions`；`resolveAction` 做 `A[choice]` 的映射
  - 这样，只要 choice 在范围内，**动作天然合法**，根本不用跑 `isLegal` 二次校验
- **收益**：从 80%+ 的"规则性非法"降到仅剩偶尔越界（<5%，并且只是边界判断的问题，重试一两次就过）
- **文件**：
  - `games/xiangqi/prompt.ts XIANGQI_TOOL`
  - `arena/runner.ts resolveAction / buildCallSpec`

### 3.2 下太快看不清

- **现象**：AvA 开局 400ms 一步，还没看清就走完开局。
- **修复**：`pages/Arena.tsx` 加了"走子间隔"下拉控件（快 0.4s / 正常 0.8s / 慢 1.5s / 很慢 3s），arena:start 时把 `moveDelayMs` 传给 sessions，runner 在每步 `await sleep(moveDelayMs)` 前塞到 cfg 里。
- **文件**：`pages/Arena.tsx` 配置表单。

---

## 4. 前端/UI 类

### 4.1 棋子没落在交叉点（方格棋盘变格子放子）

- **现象**：初始棋盘是 9x10 方格 `div` 网格，棋子放在方格里，不是中国象棋的"交叉点"布局。
- **修复**：完全重写 `components/XiangqiBoard.tsx`，改成纯 SVG：
  - `viewBox="0 -0.5 9 10.5"`，单位就是棋盘"格"；交叉点就是整数坐标 (c, r)
  - 棋子 `<circle cx={c} cy={r} r={0.46}>` + 文字 `<text y={r+0.16}>`，刚好落在交点中央
  - 画河界、九宫斜线、炮/兵位的"角标"小 L 形、a..i / 0..9 坐标标注
- **文件**：`components/XiangqiBoard.tsx` 全部函数。

### 4.2 Chat 页面"正在发言…"刷屏 + 没停止按钮

- **现象**：N 个 AI 轮着 thinking，每个 thinking 都 push 一条消息，页面滚满"正在发言…"。
- **修复**：
  - 用 `thinkingGroupByIndex: Record<number, groupId>` 维护"每个 AI 当前的 thinking 占位气泡 groupId"
  - 新 thinking 事件到来时：如果该 AI 已有未被消息替换的占位气泡，**忽略**该事件，不要 push
  - 真实 `message` 事件到来时：先 `msgs = msgs.filter(m => m.groupId !== thinkingGroupByIndex[index])` 清掉占位气泡，再把真实消息 push 到末尾
  - 渲染占位气泡时加 `@keyframes blink` 三点动画，视觉上和微信"对方正在输入"一致
- **额外加的停止按钮**：
  - 右上角独立红色大按钮（WeUI `weui-btn-warn` 风格）
  - 输入框右下角发送/停止垂直布局，运行中显示停止
  - `Esc` 全局快捷键 = 停止对话室；`Ctrl/⌘+Enter` = 发送
- **文件**：`pages/Chat.tsx` 事件处理与渲染。

### 4.3 Chat 页面 Markdown 不起作用（纯文本显示）

- **现象**：模型回复用了 `# 标题`、`- 列表`、`**加粗**`，但前端原样渲染。
- **修复**：新建零依赖 `components/Markdown.tsx` 轻量组件：
  - 代码块：三重 ```` ``` ```` 分段，保留行内空格，用等宽字体 + 浅灰底
  - 块级：`#~######` 标题、有序/无序列表、任务列表 `[x] [ ]`、引用 `> `、分隔线 `---`、表格 `| a | b |`
  - 行内：`**粗**`、`*斜*`、`` `code` ``、`[文本](url)`、自动识别裸 `http(s)://…` 链接
  - 使用 `React.createElement(ElementType, props, children)` 避免 `keyof JSX.IntrinsicElements` 类型报错（某些 strict TS 配置下会触发）
- **文件**：`components/Markdown.tsx` 全部。

### 4.4 Chat 页面长段回复一口气塞一个气泡，可读性差

- **现象**：模型输出"话题 A\n\n话题 B\n\n话题 C"三段，挤一个大胶囊气泡里。
- **修复**：`splitParagraphs(text)`：
  - 先按 `\n{2,}` 拆成段落数组
  - 每个段落独立渲染为一个 `<div class="bubble">`，同一位 AI 的多个气泡并排显示（同一条 groupId 下多个 bubble）
  - 单 `\n` 保留在段落内部，交给 Markdown 的行内 `<br/>`（末尾两个空格换行 / `<br>` 换行）处理
- **文件**：`pages/Chat.tsx splitParagraphs + renderGroup`。

### 4.5 Chat 页面整体 WeUI 风格

- **需求**：整体风格参考 `https://weui.io/`，走微信灰底 + 微信绿主色 + 气泡卡片路子。
- **修复**：`styles.css` 新增一组 CSS 变量和类：
  ```css
  --weui-page-bg: #ededed;
  --weui-primary: #07c160;   /* 微信绿 */
  --weui-me-bubble: #95ec69; /* 我方气泡 */
  --weui-card: #ffffff;
  --weui-warn: #fa5151;      /* 停止按钮红 */
  ```
  并且给 chat 页面做 `.weui-message-row` 左右布局、`.avatar` 圆形头像、`.bubble` 圆角气泡（左边白 / 右边微信绿）、`.system-tag` 灰胶囊。

---

## 5. 构建/部署/数据库类

### 5.1 tsc 不拷贝 .sql → dist/db/schema.sql 丢失

- **现象**：`npm run build` 后，`node dist/index.js` 报错
  ```
  ENOENT: no such file or directory, open '.../dist/db/schema.sql'
  ```
- **根因**：tsc 只编译 `.ts`，不会拷贝任何资源文件。
- **修复**：`db/index.ts resolveSchemaPath()` 依次尝试：
  1. `<__dirname>/schema.sql`（dist 模式，若拷贝过）
  2. `<__dirname>/../../../src/db/schema.sql`（tsc 编译出 `dist/db/index.js`，往回跳 3 级就是项目根 + `src/db/schema.sql`）
  3. 都找不到才抛错
- **文件**：`db/index.ts resolveSchemaPath()`。

### 5.2 弃用 better-sqlite3 → 改用 Node 24 内置 node:sqlite

- **现象**：`npm install better-sqlite3` 要求 node-gyp + MSVC 编译 native addon，Windows 上干净机器缺 build tools、缺 Python、缺 DLL，每次 CI / 新部署都要折腾半小时。
- **修复**：直接用 **Node 24 内置的 `require('node:sqlite').DatabaseSync`**（带 `--experimental-sqlite` flag），零原生依赖、零编译。
- **代价**：
  - 必须启动环境变量 `NODE_OPTIONS="--experimental-sqlite"`
  - 函数签名和 better-sqlite3 有点像但不完全一致（`exec(sql)` / `prepare(sql)` / `run(...)` / `all(...)` / `get(...)` 这些基本方法都有）
- **文件**：`db/index.ts` 完全用 `node:sqlite` 写。

### 5.3 前端 Vite :5173 /arena 404（没启动 vite 或端口占用）

- **现象**：用户访问 `http://localhost:5173/arena` 直接白屏/404。
- **排查**：netstat 看 :5173 LISTENING 存在与否；不存在就去 `web/` 目录 `npx vite`。
- **常见坑 1**：后台残留 vite 进程，新启动报 `Port 5173 is in use`。解决：`Stop-Process -Id $pid` 把旧 PID 干掉。
- **常见坑 2**：vite 代理 `/api` → `:4000` 但后端没起，dashboard / models 列表全报 500。解决：后端要先起。
- **修复**：每次改完代码重新跑一次健康探针：
  ```powershell
  netstat -ano | Select-String ':4000\s.*LISTENING'
  netstat -ano | Select-String ':5173\s.*LISTENING'
  Invoke-WebRequest -Uri 'http://localhost:5173/arena' -UseBasicParsing -TimeoutSec 5
  ```

---

## 6. 接口/类型类

### 6.1 `sessions.ts RuntimeOpts` 类型缺字段

- **现象**：TypeScript 编译报错：
  ```
  RuntimeOpts 上不存在 chatThinkingDefault / chatTurnDelayMs 属性
  ```
- **根因**：在 sessions 里加新 payload 字段（Chat 思考默认、轮次间隔）但忘了扩 `RuntimeOpts` 接口类型。
- **修复**：`sessions.ts interface RuntimeOpts` 加上 `chatThinkingDefault?: boolean; chatTurnDelayMs?: number;`。
- **启示**：所有"配置合并 / 透传"的字段都要有显式 type，不要 `as any` 一路糊过去，否则后续重构和前端联动都容易丢。

---

## 8. 2026-08 优化轮次新增

### 8.1 前端选定的「走子间隔」不生效（sessions.ts 忽略 payload.moveDelayMs）

- **现象**：Arena 页把 `moveDelayMs` 放在 `arena:start` payload 里发给后端，但 `sessions.ts` 只读全局设置 `opts.moveDelayMs`，前端下拉选 0.4s/0.8s/1.5s/3s 完全无效，永远用全局默认 400ms。
- **修复**：`sessions.ts` 改为 `moveDelayMs: payload.moveDelayMs ?? opts.moveDelayMs ?? 400`，前端参数优先。
- **验证**：E2E 以 80ms 间隔跑 60 秒，步数从 800ms 间隔下的 ~67 步提升到 ~253 步（约 3.8x）。

### 8.2 会话 Map 泄漏 + 断线后 runner/room 继续烧钱

- **现象**：`arenaSessions` / `chatSessions` 两个 Map 只增不减；浏览器刷新/断线后，runner/room 仍继续调用付费 LLM 并写入计费。
- **修复**：`sessions.ts` 增加 `socket.on('disconnect')` → 停止该连接名下所有会话并从 Map 移除；`arena:stop`/`chat:stop`、以及 `start().finally()`（自然终局）也统一清理。

### 8.3 模型「无视 tools 直接输出纯文本」时永远不触发降级

- **现象**：部分 Ollama / 低配模型不理会 `tools`/`tool_choice`，直接输出普通文本（HTTP 200）。旧逻辑只在 400/422 时降级，导致这类模型每回合都走「correction 重试 3 次 → 系统代走」，下棋体验极差。
- **修复**：`ArenaRunner.loop` 记录每次尝试 `respondedPlainText`（请求带 tools 但响应无 tool_calls 且解析失败）→ 立刻切文本 JSON 回退；同时把 501 也纳入 `unsupportedTools`。
- **验证**：mock 模型 `mock-plaintext`（永远返回文本 JSON）全程 32 步 0 非法；`mock-garbage`（返回乱码）触发「切换文本JSON回退 → 重试 → 系统代走」链，对局不中断。

### 8.4 provider 超时环境变量解析缺陷

- **现象**：`Number(process.env.AI_TIMEOUT_MS ?? 90000)` 若环境变量为空串/非法，`Number('') = 0` → `setTimeout(0)` 立即超时；且超时抛出的 `AbortError` 文案不友好。
- **修复**：钳制到 5s~300s 区间，非法值回退 90s；`AbortError` 转成可读的「模型调用超时（Xms）」。

### 8.5 杂项清理

- `engine.ts applyAction` 删除从未使用的 `capturedGeneral` 死代码。
- `chat/room.ts pushHumanText` 增加 `stopped` 守卫，房间停止后不再写入 transcript。
- `Chat.tsx` 收到 `over`/`error` 后清空 `sessionId`，禁止对已结束会话继续发言。
- `index.ts` 增加 SIGINT/SIGTERM 优雅退出（关闭 HTTP + Socket.IO）。
- 根 `package.json` 增加 `build`（server+web 一键构建）与 `test:server`；server 增加 `test:engine / test:e2e / test:fallback / test:mock` 脚本。

---

## 9. 一条通用经验：如何定位 LLM 集成中的怪问题

遇到"模型不输出 / 输出空 / 输出格式怪 / 参数被拒"这类 LLM 集成问题时，按下面顺序查，基本都能解：

1. **查日志里的 finish_reason**：
   - `length` → 是 `max_tokens` 太小 / thinking 打开但没给够 token
   - `stop` → 正常停止，说明内容是真的空，要去调 system prompt 或 user prompt
   - `content_filter` → 触发敏感词审查，换 phrasing
2. **把实际发的 body 打印出来（不要自己脑补）**：对比厂商 API Explorer 里的"能工作的最小请求"和你发的请求差了什么字段、多了什么字段。`provider.ts` 已经加了 finish_reason 解析打印，直接开 debug 看。
3. **能不用的字段尽量不用**：`temperature / top_p / frequency_penalty / presence_penalty / thinking / stream` 这些**可选**字段，如果业务没有强需求，全部不传，让厂商 endpoint 走 server 默认值，兼容性最佳（见 1.1 kimi 的坑）。
4. **工具调用不行就立刻切降级链**：从 strict 一路降到"纯文本 JSON + extractJson + lenientJsonify"，总有一款模型支持。纯文本 JSON 是 LLM 最低公约数，几乎所有模型都能写像样的 JSON 块。
5. **所有 "模型说错的动作" 必须被系统**代走**，永远不要为了"让模型决定"而中断对局。用户要的是能看下去的棋，不是 AI 尊严。

---

## 10. v0.2 重构轮（2026-08 第二轮）

### 10.1 下棋逻辑健壮化（业界调研结论落地）

调研了 AutoGen Chess / llm_chess（NeurIPS FoRLM 2025）/ pi-chess / Outlines 受限解码 / Kaggle Chess-Text 复盘等，落地要点：

- **错误分类**：`isTransientError()` —— 无 status（网络/超时/Abort）与 429、5xx 视为瞬时；4xx 视为永久。瞬时错误不发 correction（模型没做错，是通道问题），而是**指数退避** `400ms × 2^(n-1)`（上限 5s）后重试。
- **模型熔断**：单模型连续失败 3 次 → `downUntil = now + 30s` 冷却。冷却期内该座位直接系统代走，不再打挂掉的端点（避免持续烧超时）。成功一步即重置。
- **将军提示**：`engine.ts` 新增 `isInCheck()` 导出；prompt 检测到被将军时插入醒目「⚠ 你正被将军！请选择能解除将军的着法（系统已剔除无效解围）」，引导 LLM 优先应将。
- **三次重复判和**：`XiangqiState` 增加 `posCounts`（按"棋盘+回合"哈希累计局面出现次数），`applyAction` 走完一步后计数，`isGameOver` 检测到同一局面出现 3 次即判和「局面重复三次」（业界标准，llm_chess 显式判定重复局面，避免双方车马对磨的无意义循环）。
- **状态回显**：system prompt 增加「请先核对 user 消息中的棋盘与编号列表（状态以系统为准，勿凭记忆推断）」—— 对应 Kaggle 复盘强调的 state reconciliation，防长对局状态漂移。
- **并发守卫**：`ArenaRunner.start()` 增加 `started` 标志，防止重复启动双跑（socket 重复 emit 的边界场景）。
- **多 tool_calls**：`parseActionResponse` 在模型一次返回多个工具调用时优先取 `make_move`，其余忽略。
- **choice 容错**：`resolveAction` 容忍字符串数字（`"3"`、`" 3 "`）。
- 与业界共识一致的关键决策：**对弈主路径不用流式**（短结构化输出，流式徒增 tool_calls 分片拼接复杂度），流式只用于 Chat 长文本。

### 10.2 AI 对话室流式输出

- `provider.ts` 新增 `streamModel()`：`stream:true` + SSE 逐行解析（`data:` 前缀、`[DONE]` 结束、`delta.content` 增量、`delta.tool_calls` 按 index 拼接 arguments）；usage 缺失时用 `estimateTokens` 兜底记账；支持外部 `AbortSignal`。
- `chat/room.ts` `speakStreaming()`：逐个 content 增量 emit `{type:'delta', index, delta}`，结束后 emit `message` 全文；`stop()` 立即 abort 当前流；**流式失败（不支持 stream）自动回退非流式 callModel**。
- 前端 `Chat.tsx`：`streamBuf` ref 累积增量，`delta` 事件实时更新 thinking 气泡文本（打字机 + 闪烁光标）；`message` 事件到达后用完整文本替换（splitParagraphs 多气泡）。
- 验证：`test-stream-chat.mjs` 断言 delta 拼接 === message 全文（PASS）。

### 10.3 前端 WeUI / 微信风格重构

- `styles.css` 全量重写为微信浅色设计 token（官方色板：`--wx-brand #07C160`、页面底 `#EDEDED`、卡片 `#FFF`、文字 `rgba(0,0,0,.9)`、分割线 `rgba(0,0,0,.1)`、气泡我方 `#95EC69`）；旧变量名（`--bg/--panel/--accent`…）映射到新值，页面 JSX 改动最小化。
- `App.tsx`：深色侧边栏 → **顶部微信 navbar**（白底、绿色选中态、logo 圆点）。
- Chat 页气泡按微信规范：圆角 4px + 尾部 12px"尾巴"、头像 40px、系统提示居中。
- 表格/按钮/卡片/输入框全部微信化（cells 分割线、主绿按钮、红色危险按钮）。

### 10.4 生产实测修复：Kimi 429 并发限流 / move 事件缺 model / 429 误熔断（v0.2 第二轮）

真实对局（DeepSeek vs Kimi）暴露的三个问题：

- **Kimi 429 `max organization concurrency: 1`**：观战 AI 与下棋 AI 会同时调用同一模型（`runWatchers` 非阻塞并行 + 下棋循环并发），触发厂商账号并发上限。
  - **修复**：`provider.ts` 增加 **per-model 互斥锁**（`acquireModelLock`，按 `model.id` 串行化）——`callModel` 与 `streamModel`（锁覆盖整个流式生命周期，消费方提前 break 也会 `finally` 释放）都包锁。同一模型请求永不并发。
- **429 误触发熔断**：原逻辑把 429 计入 `recordFailure`，导致限流也被当成"模型挂了"熔断 30s。
  - **修复**：`isBreakerWorthy()` —— 仅无 status（网络/超时）与 5xx 计入熔断；429 只退避不熔断。
- **429 精确退避**：`requestCompletion` 读取 `Retry-After` 头，把 `retryAfterMs` 附到 `ModelError`；runner 瞬时错误分支优先按 `retryAfterMs` 等待（`Math.max(retryAfterMs, 100)`），无头则指数退避。
- **move 事件缺 `model` 字段**：前端 `红方 · undefined`。
  - **修复**：runner 的 move 事件（含系统代走）补充 `model: seatInfo.model.model_name`；前端 `e.model ?? seatModels[e.seat]?.model` 双保险。
- **验证**：`test-rate-limit.mjs`（mock 首次 2 次返回 429+Retry-After，之后正常）——精确 1000ms 退避、0 熔断、限流后对局恢复全 PASS；e2e（观战+下棋并发同模型池）301 步 0 非法全 PASS。

---

## 11. 自动化测试资产（2026-08 新增）

`server/` 下新增 7 个零依赖测试脚本（均可用 `node --experimental-sqlite <file>.mjs` 直接运行）：

| 文件 | 内容 |
| --- | --- |
| `test-engine.mjs` | 象棋规则引擎 70 项断言：初始 44 着、兵卒过河、炮架吃子、蹩马腿、车/相/仕/帅、将军应将、飞将、送将、吃将、困毙、三次重复判和、平局、随机冒烟 |
| `test-mock-llm.mjs` | 本地 mock OpenAI 兼容端点（:4199），支持流式/非流式：`mock-chess-a/b`（工具调用）、`mock-chat-a/b`（长文本流式）、`mock-plaintext`（纯文本 JSON）、`mock-garbage`（乱码）、`mock-down`（永远 500）、`mock-rate-limit`（429+Retry-After） |
| `test-e2e.mjs` | Socket.IO 端到端：AvA 完整对局至终局 + Chat 3 AI 1 轮，校验事件字段与状态一致性 |
| `test-stream-chat.mjs` | 流式对话验证：delta 拼接 === message 全文、事件序列正确 |
| `test-breaker.mjs` | 熔断器验证：坏模型对弈时退避 + 熔断 + 系统代走，对局不中断 |
| `test-fallback.mjs` | 验证纯文本降级 / 乱码重试 / 系统代走链 |
| `test-rate-limit.mjs` | 429 精确退避（Retry-After）+ 不熔断 + 限流后对局恢复 |

npm 入口：`npm run test:engine / test:e2e / test:stream / test:breaker / test:fallback / test:rate-limit / test:mock`（server workspace）。
