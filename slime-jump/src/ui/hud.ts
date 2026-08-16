export class HUD {
  private container: HTMLElement;
  private scoreElement: HTMLElement;
  private collectibleElement: HTMLElement;
  private levelElement: HTMLElement;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId) as HTMLElement;
    this.container.innerHTML = `
      <div class="hud">
        <div class="hud-left">
          <div class="hud-item score">
            <span class="hud-icon">⭐</span>
            <span class="hud-value" id="hud-score">0</span>
          </div>
          <div class="hud-item collectible">
            <span class="hud-icon">💎</span>
            <span class="hud-value" id="hud-collectible">0/0</span>
          </div>
        </div>
        <div class="hud-right">
          <div class="hud-item level">
            <span class="hud-icon">🎮</span>
            <span class="hud-value" id="hud-level">关卡 1</span>
          </div>
        </div>
      </div>
    `;

    this.scoreElement = this.container.querySelector('#hud-score') as HTMLElement;
    this.collectibleElement = this.container.querySelector('#hud-collectible') as HTMLElement;
    this.levelElement = this.container.querySelector('#hud-level') as HTMLElement;
  }

  setScore(score: number): void {
    this.scoreElement.textContent = score.toString();
    this.scoreElement.classList.add('score-pop');
    setTimeout(() => {
      this.scoreElement.classList.remove('score-pop');
    }, 300);
  }

  setCollectibles(current: number, total: number): void {
    this.collectibleElement.textContent = `${current}/${total}`;
    this.collectibleElement.classList.add('collectible-pop');
    setTimeout(() => {
      this.collectibleElement.classList.remove('collectible-pop');
    }, 300);
  }

  setLevel(level: number): void {
    this.levelElement.textContent = `关卡 ${level}`;
  }

  show(): void {
    this.container.style.display = 'block';
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  toggle(show: boolean): void {
    if (show) {
      this.show();
    } else {
      this.hide();
    }
  }
}