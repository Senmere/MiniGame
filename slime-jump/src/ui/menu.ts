export type MenuType = 'start' | 'win' | 'lose';

export interface MenuConfig {
  title?: string;
  score?: number;
  collectibles?: number;
  totalCollectibles?: number;
}

export class Menu {
  private container: HTMLElement;
  private startButton: HTMLElement;
  private restartButton: HTMLElement;
  private retryButton: HTMLElement;

  private onStartCallback?: () => void;
  private onRestartCallback?: () => void;
  private onRetryCallback?: () => void;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId) as HTMLElement;
    this.container.innerHTML = `
      <div class="menu-overlay">
        <div class="menu start-menu">
          <div class="menu-content">
            <div class="slime-preview">
              <div class="slime-body">
                <div class="slime-eyes">
                  <div class="eye left"></div>
                  <div class="eye right"></div>
                </div>
                <div class="slime-smile"></div>
              </div>
            </div>
            <h1 class="game-title">水花子大冒险</h1>
            <p class="game-subtitle">Slime Jump Adventure</p>
            <button class="menu-button start-btn" id="start-button">开始游戏</button>
          </div>
        </div>

        <div class="menu win-menu hidden">
          <div class="menu-content">
            <div class="win-icon">🎉</div>
            <h2 class="menu-title">恭喜通关!</h2>
            <div class="result-stats">
              <div class="stat-item">
                <span class="stat-label">最终分数</span>
                <span class="stat-value" id="win-score">0</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">收集物</span>
                <span class="stat-value" id="win-collectibles">0/0</span>
              </div>
            </div>
            <button class="menu-button restart-btn" id="restart-button">重新开始</button>
          </div>
        </div>

        <div class="menu lose-menu hidden">
          <div class="menu-content">
            <div class="lose-icon">😢</div>
            <h2 class="menu-title">游戏结束</h2>
            <p class="lose-message">史莱姆掉下去了...</p>
            <button class="menu-button retry-btn" id="retry-button">重试</button>
          </div>
        </div>
      </div>
    `;

    this.startButton = this.container.querySelector('#start-button') as HTMLElement;
    this.restartButton = this.container.querySelector('#restart-button') as HTMLElement;
    this.retryButton = this.container.querySelector('#retry-button') as HTMLElement;

    this.startButton.addEventListener('click', () => this.onStartCallback?.());
    this.restartButton.addEventListener('click', () => this.onRestartCallback?.());
    this.retryButton.addEventListener('click', () => this.onRetryCallback?.());
  }

  onStart(callback: () => void): void {
    this.onStartCallback = callback;
  }

  onRestart(callback: () => void): void {
    this.onRestartCallback = callback;
  }

  onRetry(callback: () => void): void {
    this.onRetryCallback = callback;
  }

  show(type: MenuType, config?: MenuConfig): void {
    this.hideAll();

    if (type === 'start') {
      const menu = this.container.querySelector('.start-menu') as HTMLElement;
      menu.classList.remove('hidden');
      menu.classList.add('show');
    } else if (type === 'win') {
      const menu = this.container.querySelector('.win-menu') as HTMLElement;
      const scoreElement = this.container.querySelector('#win-score') as HTMLElement;
      const collectiblesElement = this.container.querySelector('#win-collectibles') as HTMLElement;

      if (config?.score !== undefined) {
        scoreElement.textContent = config.score.toString();
      }
      if (config?.collectibles !== undefined && config?.totalCollectibles !== undefined) {
        collectiblesElement.textContent = `${config.collectibles}/${config.totalCollectibles}`;
      }

      menu.classList.remove('hidden');
      menu.classList.add('show');
    } else if (type === 'lose') {
      const menu = this.container.querySelector('.lose-menu') as HTMLElement;
      menu.classList.remove('hidden');
      menu.classList.add('show');
    }

    this.container.style.display = 'flex';
  }

  hide(): void {
    this.hideAll();
    this.container.style.display = 'none';
  }

  private hideAll(): void {
    const menus = this.container.querySelectorAll('.menu');
    menus.forEach((menu) => {
      menu.classList.remove('show');
      menu.classList.add('hidden');
    });
  }
}