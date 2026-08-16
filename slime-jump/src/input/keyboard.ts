import * as THREE from 'three';

export class Keyboard {
  private keys: Set<string>;

  constructor() {
    this.keys = new Set<string>();
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    window.addEventListener('keydown', (event) => {
      this.keys.add(event.code);
    });

    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
    });
  }

  isLeftPressed(): boolean {
    return this.keys.has('ArrowLeft') || this.keys.has('KeyA');
  }

  isRightPressed(): boolean {
    return this.keys.has('ArrowRight') || this.keys.has('KeyD');
  }

  isJumpPressed(): boolean {
    return this.keys.has('Space');
  }

  dispose(): void {
    window.removeEventListener('keydown', () => {});
    window.removeEventListener('keyup', () => {});
    this.keys.clear();
  }
}