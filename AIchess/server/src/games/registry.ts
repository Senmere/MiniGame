import type { GameAdapter } from './types.js';
import { xiangqiEngine } from './xiangqi/engine.js';

/** 游戏注册表：所有可用棋牌游戏在此注册，共享 AvA 编排器与动作编码机制。 */
export const GAMES: Record<string, GameAdapter<unknown, unknown>> = {
  xiangqi: xiangqiEngine as unknown as GameAdapter<unknown, unknown>,
};

export function getGame(id: string): GameAdapter<unknown, unknown> | null {
  return GAMES[id] ?? null;
}

export function listGames() {
  return Object.values(GAMES).map((g) => ({ id: g.id, name: g.name, minSeats: g.minSeats, maxSeats: g.maxSeats }));
}
