// DOM HUD 界面管理

import { GameState } from '../simulation/gameState';

export class HUD {
  private scoreEl: HTMLElement;
  private livesEl: HTMLElement;
  private speedEl: HTMLElement;
  private startScreen: HTMLElement;
  private gameoverScreen: HTMLElement;
  private finalScoreEl: HTMLElement;
  private highScoreEl: HTMLElement;

  constructor() {
    this.scoreEl = document.getElementById('score-value')!;
    this.livesEl = document.getElementById('lives-value')!;
    this.speedEl = document.getElementById('speed-value')!;
    this.startScreen = document.getElementById('start-screen')!;
    this.gameoverScreen = document.getElementById('gameover-screen')!;
    this.finalScoreEl = document.getElementById('final-score')!;
    this.highScoreEl = document.getElementById('high-score')!;
  }

  update(state: GameState): void {
    this.scoreEl.textContent = String(state.score);
    this.speedEl.textContent = state.velocity.length().toFixed(0);

    const hearts = [];
    for (let i = 0; i < state.maxLives; i++) {
      hearts.push(i < state.lives ? '❤️' : '🖤');
    }
    this.livesEl.textContent = hearts.join('');
  }

  showStartScreen(): void {
    this.startScreen.classList.remove('hidden');
    this.gameoverScreen.classList.add('hidden');
  }

  hideStartScreen(): void {
    this.startScreen.classList.add('hidden');
  }

  showGameOver(state: GameState): void {
    this.finalScoreEl.textContent = String(state.score);
    this.highScoreEl.textContent = String(state.highScore);
    this.gameoverScreen.classList.remove('hidden');
  }

  hideGameOver(): void {
    this.gameoverScreen.classList.add('hidden');
  }

  onStart(callback: () => void): void {
    document.getElementById('start-button')!.addEventListener('click', callback);
  }

  onRestart(callback: () => void): void {
    document.getElementById('restart-button')!.addEventListener('click', callback);
  }

  showHUD(): void {
    document.getElementById('hud')!.style.display = 'flex';
  }

  hideHUD(): void {
    document.getElementById('hud')!.style.display = 'none';
  }
}