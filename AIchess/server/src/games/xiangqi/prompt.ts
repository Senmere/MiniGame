import type { ChatMessage, ToolDef } from '../../modelPool/provider.js';
import type { XiangqiState, XiangqiAction, Side } from './engine.js';
import { pieceName, isInCheck } from './engine.js';

const PIECE_LEGEND = [
  '棋子编码：红方(大写) K帅 A仕 B相 N马 R车 C炮 P兵；黑方(小写) k将 a士 b象 n马 r车 c炮 p卒；"."为空。',
];

/**
 * make_move 工具定义：业界标准模式——
 * 系统先枚举所有合法着法（legalActions）并给每个动作一个编号 (0..N-1)，
 * 让 LLM 选一个整数编号提交。LLM 不再需要"发明坐标"，因此从根本上消除了 100% 的规则性非法着法。
 * 参考业界实践：MS AutoGen chess / pi-chess / IBM Granite chess tutorial 等均采用"先 get_legal_moves 再选一个"模式。
 *
 * strict 模式：DeepSeek/OpenAI 兼容，服务端校验 schema，避免 JSON 格式错误。
 */
export const XIANGQI_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: 'make_move',
    description:
      '提交一步中国象棋着法。从当前轮的【合法着法编号列表】中选一个编号作为 choice。禁止输出编号以外的任何动作。',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        choice: {
          type: 'integer',
          description:
            '合法着法列表的编号（整数，>=0 且 < 列表长度）。你必须使用 user 消息里"合法着法编号列表"中给出的编号。',
        },
        chat: {
          type: 'string',
          description: '自然语言聊天，仅用于展示互动不影响判局；不需要时传空字符串""。',
        },
      },
      required: ['choice', 'chat'],
      additionalProperties: false,
    },
  },
};

/** 强制调用 make_move 的 tool_choice（保证输出结构化动作）。 */
export const XIANGQI_TOOL_CHOICE = { type: 'function', function: { name: 'make_move' } } as const;

export interface PromptContext {
  legalActions: XiangqiAction[];
}

/**
 * 把一个 4-tuple 动作渲染成可读描述（与 engine.describeAction 保持一致），
 * 供 legalMoves 列表里 LLM 快速理解每个编号对应的含义。
 */
function describeMove(state: XiangqiState, a: XiangqiAction): string {
  const [fr, fc, tr, tc] = a;
  const p = state.board[fr][fc];
  const cap = state.board[tr][tc];
  const capTxt = cap !== '.' ? `吃${pieceName(cap)}` : '走';
  return `${pieceName(p)}(${fr},${fc})→(${tr},${tc})${capTxt}`;
}

/**
 * 构造给 AI 的消息：
 *   系统提示（身份+关键走法注意点） +
 *   用户消息（棋盘状态 + 【合法着法编号列表】+ 历史 + 观战评论）。
 *
 * 关键：LLM 不自己"发明坐标"，而是从枚举好的合法列表中选编号，100% 避免规则性非法。
 */
export function buildXiangqiPrompt(
  state: XiangqiState,
  seat: number,
  history: XiangqiAction[],
  watcherComments: { text: string; confidence: number }[] = [],
  ctx: PromptContext,
): ChatMessage[] {
  const side: Side = seat === 0 ? 'r' : 'b';
  const sideName = side === 'r' ? '红方' : '黑方';
  const encoded = `${state.turn}|${state.board.map((r) => r.join('')).join('/')}`;
  const rows = state.board.map((row) => row.join(' ')).join('\n');

  const historyTxt =
    history.length === 0
      ? '（开局，无历史着法）'
      : history
          .map((a) => `[${a[0]},${a[1]},${a[2]},${a[3]}]`)
          .slice(-12)
          .join(' ');

  const watcherTxt =
    watcherComments.length === 0
      ? '（无观战评论）'
      : watcherComments
          .map((w) => `(置信度 ${(w.confidence * 100).toFixed(0)}%) ${w.text}`)
          .join(' | ');

  // 合法着法编号列表（限制条目避免上下文过长，一般象棋局面几百上千步合理）。
  const legal = ctx.legalActions;
  const limit = 200;
  const legalTxt =
    legal.length === 0
      ? '（无合法着法，局面已终局）'
      : legal
          .slice(0, limit)
          .map((a, i) => `[${i}] ${describeMove(state, a)}  raw=${JSON.stringify(a)}`)
          .join('\n') + (legal.length > limit ? `\n…… 共 ${legal.length} 条合法着法（只展示前 ${limit} 条编号，请选择 0 ~ ${legal.length - 1}）` : '');

  const system = [
    '你是一名为中国象棋对局做决策的 AI。你本局执：' + sideName + '。',
    ...PIECE_LEGEND,
    '棋盘：10 行 x 9 列。row 0=黑方底线(上方)，row 9=红方底线(下方)；col 0=最左，col 8=最右。',
    '你只能移动本方棋子；所有合法着法已由系统在 user 消息中枚举并编号，你只需选择编号。',
    '动作：必须通过调用 make_move 工具的 choice 参数提交一个整数编号（从 user 消息的"合法着法编号列表"中选）。',
    '绝对禁止自己"发明"坐标；严禁输出不在列表内的编号。',
    '可选 chat 参数为自然语言聊天，仅用于展示，不影响判局。',
    '请先核对 user 消息中的棋盘与编号列表（状态以系统为准，勿凭记忆推断），再选择编号。',
    '若 user 消息中标注"警告：你正被将军！"，你必须选择能解除将军的着法（系统已自动排除仍被将军的着法）。',
    '若已方将/帅被吃或局面无路可走，请正常提交任意合法编号即可（系统会处理终局）。',
  ].join('\n');

  // 将军状态醒目提示（业界标准：给 LLM 明确的"必须应将"信号）
  const inCheck = isInCheck(state, side);
  const checkTxt = inCheck
    ? '⚠ 警告：你正被将军！请从编号列表中选择一步能解除将军的着法（系统已剔除无效解围）。'
    : '当前未将军。';

  const user = [
    '当前紧凑状态（compact）: ' + encoded,
    '当前棋盘可读视图（行号0-9，列号0-8，棋子在交叉点上）:',
    '   ' + Array.from({ length: 9 }, (_, i) => i).join(' '),
    rows,
    '轮到: ' + sideName + '。',
    checkTxt,
    '最近着法历史: ' + historyTxt,
    '观战 AI 评论（仅供参考，置信度可能为负=干扰信息，请谨慎采纳）: ' + watcherTxt,
    `合法着法编号列表（共 ${legal.length} 条，每条格式为 [编号] 中文描述  raw=四元数组）：`,
    legalTxt,
    legal.length > 0
      ? `请调用 make_move 工具，choice 填一个整数编号（0 到 ${legal.length - 1} 之间）。`
      : '无合法着法，若此局面出现请告知系统。',
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export function legend() {
  return PIECE_LEGEND.join('\n');
}

export { pieceName };
