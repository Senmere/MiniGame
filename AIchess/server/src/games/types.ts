/**
 * 动作编码机制核心抽象。
 *
 * 设计原则：AI 必须输出结构化的"动作编码"（如坐标、编号、向量），系统直接反序列化
 * 并更新游戏状态，绝不依赖自然语言解析来驱动游戏逻辑。AI 的聊天文本仅作为附加字段，
 * 与动作指令分离传输，用于展示互动。
 *
 * 每种游戏实现 GameAdapter 接口，统一被 AvA 编排器调用。
 */

export type PlayerSeat = number;

/** 棋牌游戏的紧凑状态编码（整数张量 / 位棋盘 / 字符串网格等）。 */
export interface EncodedState {
  /** 紧凑的机器可读状态（如 FEN 串、张量数组的扁平字符串） */
  compact: string;
  /** 人类可读的棋盘渲染文本（用于观战/调试展示） */
  readable: string;
  /** 任意附加键值（如当前回合、上一步等） */
  meta: Record<string, unknown>;
}

/** AI 回应：动作编码 + 可选聊天文本（二者分离传输） */
export interface AIResponse {
  action: unknown; // 由各游戏自定义 schema（如 [fr,fc,tr,tc]）
  chat?: string;   // 仅辅助互动，不参与游戏逻辑
}

export interface GameOverInfo {
  winner: PlayerSeat | null; // null = 平局
  reason: string;
}

/** 游戏适配器：每种棋牌游戏实现此接口 */
export interface GameAdapter<TState, TAction> {
  id: string;            // "xiangqi" | "go" | "doudizhu" ...
  name: string;          // 展示名
  minSeats: number;      // 最少 AI 数（象棋=2）
  maxSeats: number;      // 最多座位

  /** 创建初始状态 */
  createInitial(seats: number): TState;

  /** 编码为紧凑输入（喂给 AI） */
  encode(state: TState): EncodedState;

  /** 当前轮到哪个座位 */
  currentPlayer(state: TState): PlayerSeat;

  /** 列出某座位的合法动作（用于校验 AI 输出，以及 PvA 提示） */
  legalActions(state: TState, seat: PlayerSeat): TAction[];

  /** 校验动作是否合法（核心：动作合法性验证） */
  isLegal(state: TState, seat: PlayerSeat, action: unknown): action is TAction;

  /** 应用动作，返回新状态（不可变） */
  applyAction(state: TState, seat: PlayerSeat, action: TAction): TState;

  /** 是否结束 */
  isGameOver(state: TState): GameOverInfo | null;

  /** 动作 schema 说明（写入系统提示，告知 AI 输出格式） */
  actionSchemaDoc(): string;

  /** 把动作渲染成人类可读字符串 */
  describeAction(state: TState, action: TAction): string;
}
