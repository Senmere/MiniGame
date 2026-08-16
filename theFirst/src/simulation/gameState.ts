// 游戏模拟层 - 四元数方向 + 牛顿力学

import * as THREE from 'three';

export interface GameState {
  running: boolean;
  score: number;
  highScore: number;
  lives: number;
  maxLives: number;
  elapsed: number;
  invincibleTimer: number;

  // 飞船物理（加速度制，不做每帧覆写）
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  orientation: THREE.Quaternion; // 四元数，无万向锁
  boostActive: boolean;
}

export interface StarCollectible {
  id: number;
  position: THREE.Vector3;
  collected: boolean;
}

export interface Asteroid {
  id: number;
  position: THREE.Vector3;
  radius: number;
  mass: number;
  rotationSpeed: THREE.Vector3;
}

export function createInitialState(): GameState {
  const saved = localStorage.getItem('starTrail_highScore');
  return {
    running: false,
    score: 0,
    highScore: saved ? parseInt(saved, 10) : 0,
    lives: 3,
    maxLives: 3,
    elapsed: 0,
    invincibleTimer: 0,
    position: new THREE.Vector3(0, 0, 0),
    velocity: new THREE.Vector3(0, 0, 0),
    orientation: new THREE.Quaternion().identity(),
    boostActive: false,
  };
}

export function updateHighScore(state: GameState): void {
  if (state.score > state.highScore) {
    state.highScore = state.score;
    localStorage.setItem('starTrail_highScore', String(state.highScore));
  }
}

export function resetGameState(state: GameState): void {
  state.running = true;
  state.score = 0;
  state.lives = state.maxLives;
  state.elapsed = 0;
  state.invincibleTimer = 0;
  state.position.set(0, 0, 0);
  state.velocity.set(0, 0, 0);
  state.orientation.identity();
  state.boostActive = false;
}

// ============================================================
// 牛顿引力
// ============================================================
export const G = 800;              // 引力常数（调大让轨道感更强）
export const GRAVITY_MAX_DIST = 50; // 引力影响半径
export const GRAVITY_MIN_DIST = 1.5; // 防止奇点（距离过近时引力不再增大）

// 返回加速度向量（F/m = G*M / r² * dir），单位：m/s²
export function calcGravityAccel(
  shipPos: THREE.Vector3,
  asteroidPos: THREE.Vector3,
  asteroidMass: number
): THREE.Vector3 {
  const dir = new THREE.Vector3().copy(asteroidPos).sub(shipPos);
  const dist = dir.length();
  if (dist > GRAVITY_MAX_DIST) return new THREE.Vector3();

  // 软钳制最小距离，防止飞入奇点后被弹飞
  const effectiveDist = Math.max(dist, GRAVITY_MIN_DIST);
  const accelMag = G * asteroidMass / (effectiveDist * effectiveDist);
  return dir.normalize().multiplyScalar(accelMag);
}