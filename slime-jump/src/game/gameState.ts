export enum GameState {
  START = 'start',
  RUNNING = 'running',
  PAUSED = 'paused',
  WON = 'won',
  LOST = 'lost'
}

export interface GameStateEvents {
  onStateChange?: (newState: GameState, prevState: GameState) => void;
  onScoreChange?: (score: number) => void;
  onCollectibleChange?: (count: number) => void;
  onLevelChange?: (level: number) => void;
}

export class GameStateManager {
  private currentState: GameState = GameState.START;
  private score: number = 0;
  private collectibleCount: number = 0;
  private totalCollectibles: number = 0;
  private currentLevel: number = 1;
  private events: GameStateEvents = {};

  constructor(events?: GameStateEvents) {
    if (events) {
      this.events = events;
    }
  }

  getState(): GameState {
    return this.currentState;
  }

  getScore(): number {
    return this.score;
  }

  getCollectibleCount(): number {
    return this.collectibleCount;
  }

  getTotalCollectibles(): number {
    return this.totalCollectibles;
  }

  getCurrentLevel(): number {
    return this.currentLevel;
  }

  setTotalCollectibles(total: number): void {
    this.totalCollectibles = total;
    this.emit('onCollectibleChange', this.collectibleCount);
  }

  setCurrentLevel(level: number): void {
    this.currentLevel = level;
    this.emit('onLevelChange', level);
  }

  addScore(points: number): void {
    this.score += points;
    this.emit('onScoreChange', this.score);
  }

  addCollectible(): void {
    this.collectibleCount++;
    this.emit('onCollectibleChange', this.collectibleCount);
  }

  resetScore(): void {
    this.score = 0;
    this.emit('onScoreChange', this.score);
  }

  resetCollectibles(): void {
    this.collectibleCount = 0;
    this.emit('onCollectibleChange', this.collectibleCount);
  }

  reset(): void {
    this.score = 0;
    this.collectibleCount = 0;
    this.currentLevel = 1;
    this.emit('onScoreChange', this.score);
    this.emit('onCollectibleChange', this.collectibleCount);
    this.emit('onLevelChange', this.currentLevel);
  }

  start(): void {
    const prevState = this.currentState;
    this.currentState = GameState.RUNNING;
    this.emit('onStateChange', this.currentState, prevState);
  }

  pause(): void {
    const prevState = this.currentState;
    this.currentState = GameState.PAUSED;
    this.emit('onStateChange', this.currentState, prevState);
  }

  resume(): void {
    const prevState = this.currentState;
    this.currentState = GameState.RUNNING;
    this.emit('onStateChange', this.currentState, prevState);
  }

  win(): void {
    const prevState = this.currentState;
    this.currentState = GameState.WON;
    this.emit('onStateChange', this.currentState, prevState);
  }

  lose(): void {
    const prevState = this.currentState;
    this.currentState = GameState.LOST;
    this.emit('onStateChange', this.currentState, prevState);
  }

  goToStart(): void {
    const prevState = this.currentState;
    this.currentState = GameState.START;
    this.emit('onStateChange', this.currentState, prevState);
  }

  isRunning(): boolean {
    return this.currentState === GameState.RUNNING;
  }

  isPaused(): boolean {
    return this.currentState === GameState.PAUSED;
  }

  isGameOver(): boolean {
    return this.currentState === GameState.WON || this.currentState === GameState.LOST;
  }

  on<K extends keyof GameStateEvents>(event: K, callback: GameStateEvents[K]): void {
    this.events[event] = callback;
  }

  private emit<K extends keyof GameStateEvents>(event: K, ...args: unknown[]): void {
    const callback = this.events[event];
    if (callback) {
      (callback as (...args: unknown[]) => void)(...args);
    }
  }
}