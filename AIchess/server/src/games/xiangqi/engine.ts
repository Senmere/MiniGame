import type { GameAdapter, GameOverInfo, EncodedState, PlayerSeat } from '../types.js';

/**
 * 中国象棋引擎。
 *
 * 棋盘表示：10 行 x 9 列。
 *   row 0 = 黑方（上方），row 9 = 红方（下方）。
 *   col 0 = 左，col 8 = 右。
 * 棋子编码（单字符）：
 *   红方(大写): K帅 A仕 B相 N马 R车 C炮 P兵
 *   黑方(小写): k将 a士 b象 n马 r车 c炮 p卒
 *   空格: .
 *
 * 动作编码：[fromRow, fromCol, toRow, toCol] 四个整数。
 *   例：[9,4,7,4] 表示从(9,4)走到(7,4)。
 * 系统直接解析该整数数组并校验合法性，绝不依赖自然语言。
 */

export type Side = 'r' | 'b';
export interface XiangqiState {
  board: string[][]; // [row][col] -> 单字符
  turn: Side; // 轮到谁
  seats: number; // 座位数（固定 2）
  halfMoves: number; // 半回合数
  /** 局面出现次数（按棋盘+回合哈希），用于三次重复判和（业界标准，见 llm_chess 等） */
  posCounts?: Record<string, number>;
}

export type XiangqiAction = [number, number, number, number]; // [fr,fc,tr,tc]

/** 局面唯一键：紧凑棋盘 + 当前回合（用于重复局面统计） */
function boardKey(board: string[][], turn: Side): string {
  return turn + '|' + board.map((r) => r.join('')).join('/');
}

const RED = 'R';
const isRed = (p: string) => p !== '.' && p === p.toUpperCase();
const isBlack = (p: string) => p !== '.' && p === p.toLowerCase();
const sideOf = (p: string): Side | null => (p === '.' ? null : isRed(p) ? 'r' : 'b');
const inBoard = (r: number, c: number) => r >= 0 && r <= 9 && c >= 0 && c <= 8;

function initialBoard(): string[][] {
  const empty = () => Array(9).fill('.');
  const b: string[][] = Array.from({ length: 10 }, empty);
  // row0 黑方主力
  b[0] = ['r', 'n', 'b', 'a', 'k', 'a', 'b', 'n', 'r'];
  // row2 黑炮
  b[2][1] = 'c';
  b[2][7] = 'c';
  // row3 黑卒
  for (const c of [0, 2, 4, 6, 8]) b[3][c] = 'p';
  // row6 红兵
  for (const c of [0, 2, 4, 6, 8]) b[6][c] = 'P';
  // row7 红炮
  b[7][1] = 'C';
  b[7][7] = 'C';
  // row9 红方主力
  b[9] = ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'];
  return b;
}

const inPalace = (r: number, c: number, side: Side): boolean => {
  if (c < 3 || c > 5) return false;
  return side === 'r' ? r >= 7 && r <= 9 : r >= 0 && r <= 2;
};

// 飞将检测：两将同列且中间无子 → 当前视为非法（攻击方可"飞将"吃将）
function generalsFacing(board: string[][]): boolean {
  let rK: [number, number] | null = null;
  let bK: [number, number] | null = null;
  for (let r = 0; r < 10; r++)
    for (let c = 0; c < 9; c++) {
      if (board[r][c] === 'K') rK = [r, c];
      if (board[r][c] === 'k') bK = [r, c];
    }
  if (!rK || !bK || rK[1] !== bK[1]) return false;
  const col = rK[1];
  const [r1, r2] = [Math.min(rK[0], bK[0]), Math.max(rK[0], bK[0])];
  for (let r = r1 + 1; r < r2; r++) if (board[r][col] !== '.') return false;
  return true;
}

function cloneBoard(b: string[][]): string[][] {
  return b.map((row) => [...row]);
}

function pseudoMoves(board: string[][], r: number, c: number): [number, number][] {
  const piece = board[r][c];
  if (piece === '.') return [];
  const side = sideOf(piece)!;
  const upper = piece.toUpperCase();
  const targets: [number, number][] = [];

  const tryAdd = (tr: number, tc: number) => {
    if (!inBoard(tr, tc)) return;
    const occ = board[tr][tc];
    if (occ === '.' || sideOf(occ) !== side) targets.push([tr, tc]);
  };

  switch (upper) {
    case 'K': {
      // 帅/将：宫内一步直行
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const tr = r + dr,
          tc = c + dc;
        if (inPalace(tr, tc, side)) tryAdd(tr, tc);
      }
      break;
    }
    case 'A': {
      // 仕/士：宫内一步斜行
      for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const tr = r + dr,
          tc = c + dc;
        if (inPalace(tr, tc, side)) tryAdd(tr, tc);
      }
      break;
    }
    case 'B': {
      // 相/象：田字步（两格斜），不过河，象眼无子
      for (const [dr, dc] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
        const tr = r + dr,
          tc = c + dc;
        if (!inBoard(tr, tc)) continue;
        // 不过河
        if (side === 'r' && tr < 5) continue;
        if (side === 'b' && tr > 4) continue;
        const eyeR = r + dr / 2,
          eyeC = c + dc / 2;
        if (board[eyeR][eyeC] !== '.') continue;
        tryAdd(tr, tc);
      }
      break;
    }
    case 'N': {
      // 马：日字，蹩马腿
      const legs: [number, number, number, number][] = [
        // [legR, legC, targetR, targetC]
        [-1, 0, -2, -1], [-1, 0, -2, 1],
        [1, 0, 2, -1], [1, 0, 2, 1],
        [0, -1, -1, -2], [0, -1, 1, -2],
        [0, 1, -1, 2], [0, 1, 1, 2],
      ];
      for (const [lr, lc, tr, tc] of legs) {
        const lrAbs = r + lr,
          lcAbs = c + lc;
        if (!inBoard(lrAbs, lcAbs) || board[lrAbs][lcAbs] !== '.') continue;
        tryAdd(r + tr, c + tc);
      }
      break;
    }
    case 'R': {
      // 车：直线任意距离
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let tr = r + dr,
          tc = c + dc;
        while (inBoard(tr, tc)) {
          if (board[tr][tc] === '.') targets.push([tr, tc]);
          else {
            if (sideOf(board[tr][tc]) !== side) targets.push([tr, tc]);
            break;
          }
          tr += dr;
          tc += dc;
        }
      }
      break;
    }
    case 'C': {
      // 炮：移动同车；吃子需翻一炮架
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let tr = r + dr,
          tc = c + dc;
        // 移动阶段
        while (inBoard(tr, tc) && board[tr][tc] === '.') {
          targets.push([tr, tc]);
          tr += dr;
          tc += dc;
        }
        // 找炮架
        if (inBoard(tr, tc)) {
          tr += dr;
          tc += dc;
          while (inBoard(tr, tc)) {
            if (board[tr][tc] !== '.') {
              if (sideOf(board[tr][tc]) !== side) targets.push([tr, tc]);
              break;
            }
            tr += dr;
            tc += dc;
          }
        }
      }
      break;
    }
    case 'P': {
      // 兵/卒：未过河只前进；过河可左右
      const forward = side === 'r' ? -1 : 1;
      const crossed = side === 'r' ? r <= 4 : r >= 5;
      tryAdd(r + forward, c);
      if (crossed) {
        tryAdd(r, c - 1);
        tryAdd(r, c + 1);
      }
      break;
    }
  }
  return targets;
}

/** 是否在攻击对方将（即将军 / 可直接吃将） */
function canCaptureGeneral(board: string[][], side: Side): boolean {
  for (let r = 0; r < 10; r++)
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p === '.' || sideOf(p) !== side) continue;
      for (const [tr, tc] of pseudoMoves(board, r, c)) {
        const target = board[tr][tc];
        if (target === (side === 'r' ? 'k' : 'K')) return true;
      }
    }
  return false;
}

/**
 * 某方是否正被将军（对方存在可吃将的着法）。
 * 供 prompt 层生成「你正被将军！」提示，引导 LLM 优先应将。
 */
export function isInCheck(state: XiangqiState, side: Side): boolean {
  return canCaptureGeneral(state.board, side === 'r' ? 'b' : 'r');
}

/** 校验某方某步是否合法（执行后不能让本方将被吃 / 飞将） */
function isMoveLegal(board: string[][], fr: number, fc: number, tr: number, tc: number): boolean {
  const piece = board[fr][fc];
  const side = sideOf(piece)!;
  // 落点是否在 pseudo 范围
  const targets = pseudoMoves(board, fr, fc);
  if (!targets.some(([r, c]) => r === tr && c === tc)) return false;
  // 模拟落子
  const nb = cloneBoard(board);
  nb[tr][tc] = piece;
  nb[fr][fc] = '.';
  if (generalsFacing(nb)) return false; // 飞将
  // 落子后本方将不能被对方吃
  if (canCaptureGeneral(nb, side === 'r' ? 'b' : 'r')) return false;
  return true;
}

function hasAnyLegalMove(board: string[][], side: Side): boolean {
  for (let r = 0; r < 10; r++)
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p === '.' || sideOf(p) !== side) continue;
      for (const [tr, tc] of pseudoMoves(board, r, c)) {
        if (isMoveLegal(board, r, c, tr, tc)) return true;
      }
    }
  return false;
}

function pieceName(p: string): string {
  const map: Record<string, string> = {
    K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵',
    k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒',
  };
  return map[p] ?? p;
}

export const xiangqiEngine: GameAdapter<XiangqiState, XiangqiAction> = {
  id: 'xiangqi',
  name: '中国象棋',
  minSeats: 2,
  maxSeats: 2,

  createInitial(seats: number): XiangqiState {
    const board = initialBoard();
    return {
      board,
      turn: 'r',
      seats: 2,
      halfMoves: 0,
      posCounts: { [boardKey(board, 'r')]: 1 }, // 初始局面计数
    };
  },

  encode(state: XiangqiState): EncodedState {
    const rows = state.board.map((row) => row.join(''));
    const compact = `${state.turn}|${rows.join('/')}`;
  const readable =
    '   0 1 2 3 4 5 6 7 8\n' +
    rows
      .map((row, i) => `${i}  ${row.split('').join(' ')}`)
      .join('\n') +
    `\n轮到: ${state.turn === 'r' ? '红方' : '黑方'}`;
    return {
      compact,
      readable,
      meta: { turn: state.turn, halfMoves: state.halfMoves, rows },
    };
  },

  currentPlayer(state: XiangqiState): PlayerSeat {
    return state.turn === 'r' ? 0 : 1;
  },

  legalActions(state: XiangqiState, seat: PlayerSeat): XiangqiAction[] {
    const side: Side = seat === 0 ? 'r' : 'b';
    if (state.turn !== side) return [];
    const out: XiangqiAction[] = [];
    for (let r = 0; r < 10; r++)
      for (let c = 0; c < 9; c++) {
        const p = state.board[r][c];
        if (p === '.' || sideOf(p) !== side) continue;
        for (const [tr, tc] of pseudoMoves(state.board, r, c)) {
          if (isMoveLegal(state.board, r, c, tr, tc)) out.push([r, c, tr, tc]);
        }
      }
    return out;
  },

  isLegal(state: XiangqiState, seat: PlayerSeat, action: unknown): action is XiangqiAction {
    if (!Array.isArray(action) || action.length !== 4) return false;
    if (!action.every((v) => Number.isInteger(v))) return false;
    const [fr, fc, tr, tc] = action as number[];
    if (!inBoard(fr, fc) || !inBoard(tr, tc)) return false;
    const side: Side = seat === 0 ? 'r' : 'b';
    if (state.turn !== side) return false;
    const piece = state.board[fr][fc];
    if (piece === '.' || sideOf(piece) !== side) return false;
    return isMoveLegal(state.board, fr, fc, tr, tc);
  },

  applyAction(state: XiangqiState, seat: PlayerSeat, action: XiangqiAction): XiangqiState {
    const [fr, fc, tr, tc] = action;
    const board = cloneBoard(state.board);
    board[tr][tc] = board[fr][fc];
    board[fr][fc] = '.';
    const turn: Side = state.turn === 'r' ? 'b' : 'r';
    // 重复局面统计（三次重复判和）：以"走完后的局面+回合"为键累计
    const posCounts = { ...(state.posCounts ?? {}) };
    const key = boardKey(board, turn);
    posCounts[key] = (posCounts[key] ?? 0) + 1;
    return {
      board,
      turn,
      seats: state.seats,
      halfMoves: state.halfMoves + 1,
      posCounts,
    };
  },

  isGameOver(state: XiangqiState): GameOverInfo | null {
    // 将被吃
    let redK = false,
      blkK = false;
    for (let r = 0; r < 10; r++)
      for (let c = 0; c < 9; c++) {
        if (state.board[r][c] === 'K') redK = true;
        if (state.board[r][c] === 'k') blkK = true;
      }
    if (!redK) return { winner: 1, reason: '红帅被吃，黑方胜' };
    if (!blkK) return { winner: 0, reason: '黑将被吃，红方胜' };
    // 无合法走法 → 当前方负（困毙）
    if (!hasAnyLegalMove(state.board, state.turn)) {
      const loser = state.turn === 'r' ? 0 : 1;
      return { winner: 1 - loser, reason: `${state.turn === 'r' ? '红方' : '黑方'}困毙无路可走` };
    }
    // 三次重复局面 → 和棋（业界标准：llm_chess 显式判定重复局面，避免无意义循环）
    if (state.posCounts) {
      for (const [, cnt] of Object.entries(state.posCounts)) {
        if (cnt >= 3) return { winner: null, reason: '局面重复三次，判和' };
      }
    }
    // 和棋兜底（半回合上限）
    if (state.halfMoves > 300) return { winner: null, reason: '回合数超限，平局' };
    return null;
  },

  actionSchemaDoc(): string {
    return [
      '动作编码：输出一个 JSON 对象，必须包含 "action" 字段，值为四整数数组 [起点行, 起点列, 终点行, 终点列]。',
      '坐标系：行 0~9（0=黑方底线，9=红方底线），列 0~8（0=最左，8=最右）。',
      '可选 "chat" 字段为自然语言聊天（仅展示，不影响判局）。',
      '示例：{"action":[7,1,7,4],"chat":"炮平中"}',
      '禁止输出自然语言形式的着法，必须严格使用上述四整数数组编码。',
    ].join('\n');
  },

  describeAction(state: XiangqiState, action: XiangqiAction): string {
    const [fr, fc, tr, tc] = action;
    const piece = state.board[fr][fc];
    const cap = state.board[tr][tc];
    const capTxt = cap !== '.' ? `吃${pieceName(cap)}` : '走';
    return `${pieceName(piece)} (${fr},${fc})→(${tr},${tc}) ${capTxt}`;
  },
};

export { pieceName, sideOf };
