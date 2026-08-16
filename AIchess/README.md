# AIchess 竞技场 · 多模型能力测试与娱乐平台

> 一个 Web 端"多模型竞技场"：让多个 LLM（大语言模型）**用结构化动作编码下棋**、**流式自由对话**，并提供统一的模型池、计费监控和观战 AI 评论体系。设计哲学是"**游戏决策必须走结构化动作**，聊天文本与动作严格分离"，彻底规避靠自然语言解析驱动游戏逻辑的所有坑。
>
> v0.2 重构：① 下棋逻辑全面健壮化（错误分类/指数退避/模型熔断/将军提示/状态回显）；② AI 对话室**流式输出**（打字机渲染 + 中途停止）；③ 前端按 **WeUI / 微信设计规范**整体重构。

## 1. 项目定位与核心理念

| 理念 | 说明 |
| --- | --- |
| 动作编码驱动 | AI 下棋输出的是 `[起点行,起点列,终点行,终点列]`（四元整数数组）或**合法着法编号**，系统直接解析并执行合法性校验，绝不靠"炮二平五"这种文本去猜。 |
| 动作 / 聊天分离 | 每个 AI 回复是个对象 `{action\|choice, chat}`；`action/choice` 驱动游戏，`chat` 只用于展示，互不干扰。 |
| 全局模型池 | 用户在"设置页"一次性配置 N 组 `Base URL + Model + API Key + 单价`，AvA / Chat / 观战 AI 都从同池里抽样。 |
| 统一计费监控 | 每次 LLM 调用的输入/输出 token 数都被记录，仪表盘按模型汇总调用次数和预估费用。 |
| 多厂商兼容 | 统一走 OpenAI 兼容 `POST /chat/completions`，DeepSeek strict 工具调用自动切 beta 路径；不支持工具调用的模型自动降级到文本 JSON。 |
| 流式输出 | AI 对话室走 `stream:true` SSE 增量渲染（打字机效果），支持中途停止；下棋主路径保持非流式（业界共识：短结构化输出不推荐流式）。 |

## 2. 三种独立模式

### 2.1 AvA 竞技场（AI vs AI 棋牌对战）
- 游戏：当前内置**中国象棋**（可扩展更多棋牌，只需实现 `GameAdapter` 接口）
- 流程：
  1. 系统枚举当前局面的**全部合法着法**并编号 0..N-1
  2. 把"合法着法编号列表"喂给 AI（prompt 里写成 `[15] 炮(7,1)→(5,1)走 raw=[7,1,5,1]` 的形式）
  3. AI 通过 **`make_move(choice:int, chat:string)`** 工具调用提交编号
  4. 系统用编号反查具体动作 → 合法性验证（已枚举天然合法）→ 执行
- 额外特性：
  - **观战 AI**：每隔 N 步调用一次旁观 AI 给出评论，置信度区间设为 -20% ~ -10%（故意干扰/低可信，让下棋 AI 不会被观战评论左右）
  - **系统代走兜底**：LLM 连续非法用尽重试次数，系统随机代走一步合法着法并在聊天里标注"【系统代走】"
  - **走子间隔可调**：0.4s / 0.8s（默认） / 1.5s / 3s
  - **健壮性（v0.2）**：
    - **错误分类**：瞬时错误（网络/超时/429/5xx）与永久错误（4xx）区分对待
    - **指数退避**：瞬时错误按 `400ms × 2^(n-1)` 退避重试，不浪费 correction
    - **模型熔断**：单模型连续失败 3 次 → 熔断冷却 30s，期间系统代走，避免反复打挂掉的端点
    - **将军提示**：引擎检测到被将军时在 prompt 中醒目标注"⚠ 你正被将军！"，并提示系统已剔除无效解围
    - **状态回显**：system 提示要求 LLM 以系统棋盘为准，防状态漂移（业界 state reconciliation）
    - **并发守卫**：`ArenaRunner.start()` 幂等，防止重复启动双跑
    - **多 tool_calls**：一次返回多个工具调用时优先取 `make_move`

### 2.2 AI 对话室（AI Chat with AI）
- 纯文本多 AI 对话：N 个 AI 按座位顺序轮流发言，话题可预设（如"AI 会不会取代程序员"）
- **流式输出（v0.2）**：发言走 `stream:true`，服务端逐块推送 `delta` 事件，前端**打字机渲染**（闪烁光标）；模型不支持流式时自动回退非流式
- 玩家可插入消息（Ctrl/⌘+Enter 发送），可配置是否把玩家发言注入 AI 的上下文
- 配置项：AI 数量、话题、最大轮次、**发言间隔**、**是否开启思考模式**、玩家注入上下文
- WeUI 风格界面（浅灰底 + 微信绿气泡 + 头像卡片 + Markdown 渲染）
- Markdown 支持：代码块、行内代码、#~###### 标题、有序/无序列表、任务列表 [x]、引用、粗体斜体、链接、自动识别裸链接、分隔线、表格
- **换行分段**：模型输出一段 `\n\n` 两个空行以上的内容会拆成多个气泡并排显示，符合聊天观感
- 思考模式开关：全局 Settings 默认值 + Chat 页每次单独复选；开 thinking 时单次 maxTokens=1500，不开=500
- 停止按钮：右上角红色大按钮 + 输入框右下角 + `Esc` 快捷键，三端都能停；**流式中途停止会立刻中断出字**

### 2.3 PvA 玩家 vs AI 对战
> 未实现（架构接口已留空，见下文"未实现"）

## 3. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│  web (React 19 + Vite 8 + Socket.IO client)                 │
│    pages/  Dashboard  Arena(Ai vs Ai)  Chat  Settings       │
│    components/  XiangqiBoard(SVG 传统棋盘)   Markdown        │
│    ↕ Socket.IO client                                        │
└────────────────────────┬────────────────────────────────────┘
                         │ WebSocket (事件流) + REST(/api)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  server (Fastify 5 + Socket.IO 4 + Node 24 内置 sqlite)      │
│  ┌───────────┐  ┌──────────┐  ┌───────────┐  ┌────────────┐ │
│  │ sessions  │→│ ArenaRunner│  │ ChatRoom  │  │   routes   │ │
│  └─────┬─────┘  └────┬─────┘  └─────┬─────┘  └──────┬─────┘ │
│        │             │              │                 │       │
│  ┌─────▼─────────────▼──────────────▼─────────────────▼────┐ │
│  │ modelPool (store→db, pool抽样, provider HTTP调用)        │ │
│  │ games/xiangqi (engine状态机, legalActions, prompt+tol)   │ │
│  │ billing/tracker → call_logs 表                           │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                         │ POST /chat/completions
                         ▼
              各家模型 API (DeepSeek / Kimi / 本地...)
```

### 3.1 目录速览

```
AIchess/
├── server/                          后端 (TypeScript + Fastify + node:sqlite)
│   └── src/
│       ├── index.ts                 Fastify 启动（默认 :4000）
│       ├── sessions.ts              Socket.IO 会话：arena:start / chat:start 入口
│       ├── routes/index.ts          /api/models|settings|games|dashboard
│       ├── db/
│       │   ├── index.ts             node:sqlite DatabaseSync 封装
│       │   └── schema.sql           建表：models / settings / call_logs
│       ├── modelPool/
│       │   ├── store.ts             models 表 CRUD
│       │   ├── pool.ts              N 个座位抽样 / 观战 AI 抽样
│       │   └── provider.ts          统一 chat/completions 调用（tools, 三级降级, lenient JSON, 计费记录）
│       ├── arena/runner.ts          AvA 编排：思考提示、重试、观战 AI、代走兜底
│       ├── chat/room.ts             AI 对话室：多 AI 轮流发言 + 玩家插入
│       ├── billing/tracker.ts       call_logs 写入 + 仪表盘汇总
│       └── games/
│           ├── types.ts             GameAdapter<TState,TAction> 核心抽象（动作编码接口）
│           ├── registry.ts          注册所有游戏（目前只有 xiangqi）
│           └── xiangqi/
│               ├── engine.ts        中国象棋规则机 + 合法着法枚举（炮架/蹩马腿/相眼…）
│               └── prompt.ts        system prompt 模板 + XIANGQI_TOOL(choice:int) 工具 schema
├── web/                             前端 (React 19 + Vite 8 + TypeScript)
│   └── src/
│       ├── App.tsx                  Sidebar + 4 个路由
│       ├── socket.ts                Socket.IO 客户端
│       ├── api/client.ts            REST 客户端：/api/models|settings|dashboard
│       ├── pages/
│       │   ├── Dashboard.tsx        计费汇总仪表盘
│       │   ├── Arena.tsx            AvA 竞技场前端（棋盘 + 走子间隔 + 事件日志）
│       │   ├── Chat.tsx             AI 对话室（WeUI 风格 + Markdown + 思考模式）
│       │   └── Settings.tsx         模型池增删改 + 全局运行时参数
│       ├── components/
│       │   ├── XiangqiBoard.tsx     SVG 绘制传统中国象棋棋盘（棋子落交叉点、河界九宫角标坐标）
│       │   └── Markdown.tsx         零依赖轻量 Markdown 渲染
│       └── styles.css               全局样式（深色仪表盘主题 + WeUI 浅色调 Chat 风格）
├── dev.ps1                          Windows 一键启动脚本（前后端同时起）
└── package.json                     workspaces 根（虽然没 lerna/npm workspaces，两个子项目独立）
```

### 3.2 关键设计：合法着法枚举（业界标准模式）

参考 MS AutoGen Chess / IBM Granite Chess Tutorial / pi-chess 等实现，LLM 下棋规则性非法着法的根治方案是**限制输出空间（Constrain the Output Space）**：

1. 系统通过 `GameAdapter.legalActions(state, seat)` 枚举当前座位的全部合法动作列表 `A[]`，长度 N
2. Prompt 里注入"**合法着法编号列表**"：每行 `[编号] 描述 raw=[fr,fc,tr,tc]`
3. 工具调用 schema 不接受 `action: [int,int,int,int]`，只接受 `choice: integer`（0 ≤ choice < N）
4. 系统在 `ArenaRunner.resolveAction()` 里把 `choice` 映射回 `A[choice]`，天然合法，**永远不会出现规则性非法着法**
5. 如果 LLM 给的 choice 越界，仍走 correction 重试；连续越界用尽才系统代走

这样 LLM 唯一可能犯的错误就是"**把数字给错了**"，而不是靠概率去"记忆"炮要隔一个炮架、马会被蹩腿这些离散规则——后者对 LLM 天生不靠谱（文章 *ChatGPT Can Write a Chess Book But Can't Move a Pawn* 给出过详细验证）。

### 3.3 关键设计：三级降级 + 宽松 JSON 解析

不同厂商/模型对 tools / strict 支持程度不同，因此 provider 设计了三级调用链和宽松解析：

```
strict tool_calls（DeepSeek → 自动走 /beta/chat/completions）
   ↓ 失败
non-strict tool_calls（去掉 strict: true 再试）
   ↓ 失败
文本 JSON 回退（system 里要求严格按 JSON schema 输出，模型输出走 extractJson 宽松解析）
```

`extractJson` 的 lenient 化步骤（`lenientJsonify`）：
- 去 `//` 行注释和 `/* */` 块注释
- 去对象/数组尾逗号 `, }` → `}`
- 单引号字符串整体转双引号（并转义其中未转义的 `"`）
- 给 unquoted 的 JS-style key 补双引号：`{a:1}` → `{"a":1}`

Kimi-k2.5 这类模型还有额外限制：**只允许 temperature=1**，所以后来改成了"只有 `opts.temperature !== undefined` 才往请求里写这个字段"，其他模型用服务器默认值即可（见已解决问题清单）。

## 4. 已实现的目标

- [x] 全局模型池（增删改查 + 启用/停用），所有模式共享；支持 Base URL 任意（Ollama/DeepSeek/其他 OpenAI 兼容端点）、每模型输入/输出单价元/千 token
- [x] AvA 模式：中国象棋，座位 2，支持观战 AI 1~N
- [x] AvA：合法着法编号枚举（choice:int） + XIANGQI_TOOL strict 工具调用
- [x] AvA：三级降级（strict → non-strict → 文本 JSON lenient 解析）
- [x] AvA：系统代走兜底 + 清晰标注
- [x] AvA：走子间隔可调（0.4 / 0.8 / 1.5 / 3 s）
- [x] AvA：棋盘 SVG 重新绘制（棋子落在**交叉点**上，河界、九宫斜线、炮/兵位角标、坐标标签齐全）
- [x] AI 对话室：N 个 AI 轮流发言，话题可选，最大轮次
- [x] AI 对话室：可选开启思考模式（默认关，thinking 开后 tokens 拉到 1500）
- [x] AI 对话室：停止按钮（右上角大红按钮 + 输入框右下 + Esc 快捷键）
- [x] AI 对话室：Markdown 渲染（零依赖，覆盖列表/表格/代码/标题/引用/链接等）
- [x] AI 对话室：空行 `\n\n` → 多气泡分段
- [x] AI 对话室：WeUI 风格（#ededed 底 + #07c160 微信绿 + #95ec69 我方气泡 + 浅灰圆头像 + 微信式排版）
- [x] AI 对话室：正在发言占位气泡 thinking→消息替换机制（同 AI 永远只挂一个占位，不刷屏）
- [x] 仪表盘：按模型汇总调用次数 + 输入/输出 token + 预估费用
- [x] 计费：每次 `callModel` 写 `call_logs` 表（含会话、模式、模型、token 数、成本、时间戳）
- [x] Settings：全局默认值（观战置信度范围/每几步观战/走子间隔/对话发言间隔/对话默认思考模式）保存
- [x] 服务端：**node:sqlite**（Node 24 内置 `DatabaseSync`，`--experimental-sqlite` 打开）代替 better-sqlite3，完全不需要 node-gyp/原生编译，省磁盘省折腾
- [x] schema.sql 缺失兜底：`tsc` 只复制 js，`dist/db/schema.sql` 找不到时回退 `src/db/schema.sql`
- [x] REST 健康探针：`GET /api/health`

## 5. 未实现 / 预留接口 / 已知问题

### 5.1 未实现的核心功能

| 功能 | 进度 | 阻塞点 |
| --- | --- | --- |
| PvA 模式（玩家 vs AI 对弈前端交互） | 仅 `GameAdapter` 接口就绪，前端无页面无点击落子逻辑 | 需要人类点击棋盘 → 生成动作 → 与 AI 回合交替；AI 思考状态展示 |
| 多游戏扩展（国际象棋、五子棋、斗地主、德州扑克……） | 只有 `xiangqi` 在 games/registry 注册 | 需要按 `GameAdapter<TState, TAction>` 写规则机 + prompt 工具 schema + 前端棋盘组件 |
| 流式响应 (SSE / WebSocket chunk) | 当前 `callModel` 是一次性 POST，等全响应回来再解 | 需要 SSE 或 /v1/chat/completions `stream: true` + 增量拼接 |
| 对话室保存 / 历史对局回放 | 聊天和 AvA 都没有落盘历史，只有 call_logs 计费记录 | 需要 sessions 表 + moves/chat_messages 表 |
| 真实身份鉴权 | 所有接口都是开放的，没 user 概念、没登录 | 对单机自托管无影响；多人共享需要加 JWT |
| 模型池加密存储 | 目前 api_key 是明文存 `models.api_key` | 生产环境需要 master key + AES-GCM |
| 前端错误边界 + 断网重连提示 | Socket.IO 自动重连已有，但是 UI 上没有离线横幅 | 需加 `io.on('disconnect')` 提示条 |

### 5.2 已知问题与 trade-off

- **DeepSeek JSON mode 空响应坑**：JSON mode 要求 system 里出现 `json` 字样 + `max_tokens` 不能太小 + 尽量关 thinking。目前下棋路径全部关 thinking + 走 strict 工具调用，避坑；文本回退路径刻意不开启 jsonMode，而用 `extractJson` 去挖。
- **thinking 模式 + 小 max_tokens = 空响应**：开 thinking 后 token 会被思考消耗，如果 `max_tokens` 设成 300，经常 `finish_reason=length` 但 content 是空的。对话室已自动：开 thinking 默认 maxTokens=1500。
- **观战 AI 上下文很浅**：观战 AI 每次只给"当前棋盘 + 上一步"一段，不给完整历史，评论偏静态。要深点评需要每次带上 `history.slice(-20)`。
- **Markdown 组件是轻量版**：没有嵌套块引用、复杂 GFM autolink 识别、脚注、数学公式 MathJax/KaTeX。普通写作够用，复杂排版需要引入 `react-markdown + remark-gfm + remark-math`。
- **温度参数硬编码**：AvA 下棋 `temperature=0.4`、观战 AI `temperature=1.0`，都没在 Settings 暴露。
- **不同厂商对 thinking 字段支持不一致**：目前只给 DeepSeek 域名传 `{thinking:{type:'enabled/disabled'}}`（`provider.ts`），其他厂商忽略未知字段也 OK；Kimi/通义如果后续要开思考，得在 provider 里加分支。
- **对局无持久化**：chat / AvA 历史仅存在于内存（`sessionId` 对应的 runner/room），刷新页面即丢失；计费记录 `call_logs` 是唯一落盘数据。

## 5.3 自动化测试

`server/` 下内置了几组零依赖测试脚本（`npm run test*`，需要先 `npm run build` 或直接 `node --experimental-sqlite *.mjs`）：

| 脚本 | 说明 |
| --- | --- |
| `npm run test:engine`（`test-engine.mjs`） | 中国象棋引擎规则测试：初始着法数、兵/卒过河、炮架、蹩马腿、车/相/仕/帅、将军与应将、飞将、送将、吃将终局、困毙、半回合上限平局、随机对局冒烟。**67 项全过**。 |
| `npm run test:e2e`（`test-e2e.mjs`） | 端到端 Socket.IO 测试：`arena:start`（2 AI + 观战 AI）跑完整局至终局、`chat:start`（3 AI 1 轮），校验 move/state/thinking/over 事件字段与 halfMoves 一致性。需后端 + mock LLM 同时运行。 |
| `npm run test:stream`（`test-stream-chat.mjs`） | 流式对话验证：确认 `thinking → 多个 delta → message → over` 事件序列，且 delta 拼接与 message 全文一致（打字机渲染正确）。 |
| `npm run test:breaker`（`test-breaker.mjs`） | 熔断器验证：两个 `mock-down`（永远 500）模型对弈时，瞬时错误触发指数退避、连续失败触发熔断冷却、系统代走维持对局不中断。 |
| `npm run test:fallback`（`test-fallback.mjs`） | 验证「模型无视 tools 返回纯文本」时自动降级到文本 JSON、以及返回乱码时走重试→系统代走链。 |
| `npm run test:mock`（`test-mock-llm.mjs`） | 本地 mock OpenAI 兼容 `/chat/completions` 端点（`:4199`），支持流式与非流式，可模拟工具调用模型 / 纯文本模型 / 乱码模型 / 故障模型。 |

E2E 用法：先起后端（`node dist/index.js`，`DB_PATH` 指向测试库）与 mock（`node test-mock-llm.mjs`），再向 `/api/models` 添加指向 `http://localhost:4199` 的模型（`model_name` 分别为 `mock-chess-a/b`、`mock-chat-a/b`、`mock-plaintext`、`mock-garbage`、`mock-down` 可切换不同行为），最后 `node test-e2e.mjs`。

## 6. 本地启动（Windows）

> 项目内置了 **Node 24.19.0 win-x64** 便携版在 `.tools/node-v24.19.0-win-x64/`，省去本机装 Node。

### 6.1 安装依赖（首次）

```powershell
# 后端
$env:PATH = "d:\BIAN\AIchess\.tools\node-v24.19.0-win-x64;$env:PATH"
cd server ; npm install ; cd ..

# 前端
cd web ; npm install ; cd ..
```

### 6.2 启动后端

```powershell
$env:PATH = "d:\BIAN\AIchess\.tools\node-v24.19.0-win-x64;$env:PATH"
cd server
npm run build                           # 可选，tsc 编译到 dist/
$env:NODE_OPTIONS = "--experimental-sqlite"
node dist/index.js                      # 默认 :4000
```

如果 `dist/db/schema.sql` 找不到，会自动回退到 `src/db/schema.sql` 读。

### 6.3 启动前端

```powershell
$env:PATH = "d:\BIAN\AIchess\.tools\node-v24.19.0-win-x64;$env:PATH"
cd web
npx vite --host 0.0.0.0                  # 默认 :5173，vite.config 里 /api 代理到 :4000
```

### 6.4 快捷脚本（推荐）

- **`start.bat`（双击即用）**：项目根目录双击即可一键启动前后端。自动使用内置便携 Node；首次运行自动 `npm install`；5 秒后自动打开浏览器；`Ctrl+C` 停止。命令行加 `--no-browser` 可跳过自动开浏览器。**注：bat 为纯 ASCII 内容（英文提示），避免中文 Windows 代码页乱码导致解析失败。**
- 根目录 `dev.ps1`（PowerShell 版，需允许执行脚本）：功能同上，输出中文提示。

### 6.5 首次使用流程

1. 打开 `http://localhost:5173/settings`
2. "添加模型"：填 Label / Base URL（如 `https://api.deepseek.com`）/ Model Name（如 `deepseek-v4-flash`）/ API Key / 单价（0 即可）
3. 至少加 1 个模型（AvA 2 AI 默认从池里有放回抽样）
4. 开 AvA：`http://localhost:5173/arena` → 选择走子间隔 → 开始对局
5. 开 Chat：`http://localhost:5173/chat` → 勾"思考模式"、填话题 → 开启对话
6. 看账单：`http://localhost:5173/` 仪表盘

## 7. API / Socket.IO 事件一览

### 7.1 REST `/api/*`

| Method | Path | 说明 |
| --- | --- | --- |
| GET  | `/api/health` | `{ ok: true }` 健康检查 |
| GET  | `/api/models` | 模型池列表 |
| POST | `/api/models` | 新增模型（body 见 `ModelSchema` in routes/index.ts） |
| PUT  | `/api/models/:id` | 更新模型（字段可选） |
| DELETE | `/api/models/:id` | 删除模型，返回 `{ deleted: boolean }` |
| GET  | `/api/games` | 可玩游戏列表 `[{id,name,minSeats,maxSeats}]` |
| GET  | `/api/settings` | JSON 对象：`{watcherConfidenceRange, watcherEvery, moveDelayMs, chatThinkingDefault, chatTurnDelayMs}` |
| POST | `/api/settings` | 合并保存到 settings 表 |
| GET  | `/api/dashboard` | 计费汇总：`{ byModel: [...], totals: {calls, input_tokens, output_tokens, cost} }` |

### 7.2 Socket.IO AvA 事件

| 事件 | 方向 | Payload |
| --- | --- | --- |
| `arena:start` | C→S | `{ gameId:"xiangqi", seats:2, watcherCount:1 }` |
| `arena:started` | S→C | `{ sessionId }` |
| `arena:event` | S→C | `{ sessionId, event: {type:'init'|'state'|'thinking'|'move'|'illegal'|'watcher'|'human'|'over'|'error', ...} }` |
| `arena:human` | C→S | `{ sessionId, text }` 人类插入文字（注入观战 AI） |
| `arena:stop` | C→S | `{ sessionId }` 停止对局 |

### 7.3 Socket.IO Chat 事件

| 事件 | 方向 | Payload |
| --- | --- | --- |
| `chat:start` | C→S | `{ memberCount:3, topic?:string, injectHumanContext?:true, maxRounds?:20, thinking?:false, maxTokens?:undefined, turnDelayMs?:900 }` |
| `chat:started` | S→C | `{ sessionId }` |
| `chat:event` | S→C | `{ sessionId, event: {type:'init'|'thinking'|'message'|'over'|'error', ...} }` |
| `chat:human` | C→S | `{ sessionId, text }` 玩家插一句 |
| `chat:stop` | C→S | `{ sessionId }` 停止对话室 |

## 8. 扩展指南：如何加一种新棋牌游戏？

以"五子棋 gomoku"为例：

1. 在 `server/src/games/` 下建目录 `gomoku/`，写：
   - `engine.ts`：棋盘表示 + `legalActions(state, seat)` + `isLegal` + `applyAction` + `isGameOver`（五连判胜）
   - `prompt.ts`：system 模板 + `GOMOKU_TOOL`（`make_move(choice:int, chat:string)` strict 工具 schema）+ `buildGomokuPrompt(state, legalActions, history)`
2. 在 `games/types.ts` 保证你的引擎能返回 `EncodedState`（compact + readable）
3. 在 `games/registry.ts` 里注册一个实例：
   ```ts
   games.push(new GomokuAdapter());
   ```
4. 前端如果需要自定义棋盘，在 `web/src/components/` 建 `GomokuBoard.tsx`，并在 `pages/Arena.tsx` 里按 `gameId` 分支渲染；否则就用通用 readable 文本展示。
5. 自动继承：AvA 的合法着法枚举、系统代走兜底、计费、观战 AI 全部不用改，直接能跑。

> 关键是 **`legalActions` 一定要正确**，这是 Constrain-the-Output-Space 模式的核心命门。

## 9. 相关文档

- 已解决问题与踩坑清单：见 [`./docs/SOLVED_PROBLEMS.md`](./docs/SOLVED_PROBLEMS.md)
- 微信官方 WeUI 编译版 CSS（weui@2.5.13，前端设计参考）：见 [`./docs/weui-official.css`](./docs/weui-official.css)
- 中国象棋引擎规则：参考 [engine.ts](server/src/games/xiangqi/engine.ts) 顶部注释
- LLM 下棋行业标准做法的调研与消息流示例：见代码评审记录（合法着法编号枚举一节）
