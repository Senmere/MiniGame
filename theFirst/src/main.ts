// 星轨收集者 - 四元数方向 + 牛顿力学版
// 真实物理：推力加速度 / 引力加速度 / 阻力，不覆写速度

import * as THREE from 'three';
import { createRenderContext, RenderContext } from './render/scene';
import { createPlayerShip, updateEngineGlow } from './render/player';
import { createStar, createAsteroid, createGravityRing, createCollectEffect } from './render/collectibles';
import { createStarfield, updateStarfield } from './render/stars';
import {
  GameState, StarCollectible, Asteroid,
  createInitialState, updateHighScore, resetGameState,
  calcGravityAccel, GRAVITY_MAX_DIST,
} from './simulation/gameState';
import { createInputHandler } from './input';
import { HUD } from './ui/hud';

// ============================================================
// 游戏常量
// ============================================================
const WORLD_SIZE = 200;
const THRUST_POWER = 25;       // 基础推力加速度 (m/s²)
const BOOST_POWER = 70;        // 加速推力加速度
const DRAG_COEFFICIENT = 0.015; // 阻力系数 (quadratic drag)
const ROTATION_SPEED = 2.5;    // 旋转速度 (rad/s)
const COLLECT_DISTANCE = 2.8;
const ASTEROID_COLLIDE_DISTANCE_RATIO = 0.9;
const INVINCIBLE_DURATION = 2.0;
const STAR_COUNT = 80;
const ASTEROID_COUNT = 12;

// ============================================================
// 主游戏类
// ============================================================
class Game {
  private ctx: RenderContext;
  private state: GameState;
  private hud: HUD;
  private input: ReturnType<typeof createInputHandler>;

  private ship!: THREE.Group;
  private starfield!: THREE.Points;
  private starObjects: Map<number, THREE.Group> = new Map();
  private asteroidObjects: Map<number, { group: THREE.Group; ring: THREE.Mesh }> = new Map();
  private effects: { obj: THREE.Points; life: number }[] = [];

  private stars: StarCollectible[] = [];
  private asteroids: Asteroid[] = [];
  private starTemplate: THREE.Group | null = null;
  private nextId = 0;
  private lastTime = 0;
  private animationId = 0;

  private cameraTarget = new THREE.Vector3();
  private cameraSmoothPos = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = createRenderContext(canvas);
    this.state = createInitialState();
    this.hud = new HUD();
    this.input = createInputHandler(canvas);

    this.buildScene();
    this.bindUI();
    this.hud.showStartScreen();
    this.hud.hideHUD();

    this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);
    this.lastTime = performance.now();
    this.loop(performance.now());
  }

  // ============================================================
  // 场景
  // ============================================================
  private buildScene(): void {
    this.starfield = createStarfield();
    this.starfield.scale.set(5, 5, 5);
    this.ctx.scene.add(this.starfield);

    this.ship = createPlayerShip();
    this.ctx.scene.add(this.ship);

    this.starTemplate = createStar();
    this.createWorldGrid();
    this.spawnAllStars();
    this.spawnAllAsteroids();
  }

  private createWorldGrid(): void {
    const gs = WORLD_SIZE;
    const g1 = new THREE.PolarGridHelper(gs, 32, 20, 64, 0x334466, 0x223355);
    g1.position.y = -gs / 2;
    this.ctx.scene.add(g1);
    const g2 = new THREE.PolarGridHelper(gs, 32, 20, 64, 0x334466, 0x223355);
    g2.position.y = gs / 2;
    this.ctx.scene.add(g2);
  }

  private spawnAllStars(): void {
    for (let i = 0; i < STAR_COUNT; i++) {
      const pos = this.randomWorldPosition(10, WORLD_SIZE * 0.45);
      const star: StarCollectible = {
        id: this.nextId++,
        position: pos.clone(),
        collected: false,
      };
      this.stars.push(star);
      const obj = this.starTemplate!.clone(true);
      obj.position.copy(pos);
      obj.userData = { id: star.id };
      this.ctx.scene.add(obj);
      this.starObjects.set(star.id, obj);
    }
  }

  private spawnAllAsteroids(): void {
    for (let i = 0; i < ASTEROID_COUNT; i++) {
      const radius = 2 + Math.random() * 5;
      const pos = this.randomWorldPosition(20, WORLD_SIZE * 0.4);
      const asteroid: Asteroid = {
        id: this.nextId++,
        position: pos.clone(),
        radius,
        mass: radius * radius * 5,
        rotationSpeed: new THREE.Vector3(
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.5
        ),
      };
      this.asteroids.push(asteroid);

      const group = createAsteroid(radius);
      group.position.copy(pos);
      group.userData = { id: asteroid.id };
      this.ctx.scene.add(group);

      const ring = createGravityRing(GRAVITY_MAX_DIST);
      ring.position.copy(pos);
      this.ctx.scene.add(ring);

      this.asteroidObjects.set(asteroid.id, { group, ring });
    }
  }

  private randomWorldPosition(minDist: number, maxDist: number): THREE.Vector3 {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const radius = minDist + Math.random() * (maxDist - minDist);
    return new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta) * radius,
      Math.sin(phi) * Math.sin(theta) * radius,
      Math.cos(phi) * radius
    );
  }

  // ============================================================
  // UI
  // ============================================================
  private bindUI(): void {
    this.hud.onStart(() => this.startGame());
    this.hud.onRestart(() => this.startGame());
  }

  private startGame(): void {
    resetGameState(this.state);
    this.hud.hideStartScreen();
    this.hud.hideGameOver();
    this.hud.showHUD();
    this.hud.update(this.state);

    this.clearAll();
    this.nextId = 0;
    this.stars = [];
    this.asteroids = [];
    this.starObjects.clear();
    this.asteroidObjects.clear();
    this.spawnAllStars();
    this.spawnAllAsteroids();

    this.ship.visible = true;
    this.ship.position.set(0, 0, 0);
    this.ship.quaternion.identity();
  }

  private gameOver(): void {
    this.state.running = false;
    updateHighScore(this.state);
    this.hud.showGameOver(this.state);
    this.hud.hideHUD();
  }

  // ============================================================
  // 主循环
  // ============================================================
  private loop = (now: number): void => {
    this.animationId = requestAnimationFrame(this.loop);
    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const dt = Math.min(rawDt, 0.1);

    if (this.state.running) {
      this.update(dt);
    }

    updateStarfield(this.starfield, now * 0.001);
    this.updateEffects(dt);
    this.updateCamera(dt);
    this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);
  };

  // ============================================================
  // 物理更新
  // ============================================================
  private update(dt: number): void {
    this.state.elapsed += dt;

    if (this.state.invincibleTimer > 0) {
      this.state.invincibleTimer -= dt;
    }

    const input = this.input.getState();

    // ── 四元数旋转（无万向锁，无角度钳制） ──
    const orient = this.state.orientation;

    // 世界 Y 轴偏航
    const qYaw = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), input.yaw * ROTATION_SPEED * dt
    );
    // 本地 X 轴俯仰
    const localRight = new THREE.Vector3(1, 0, 0).applyQuaternion(orient);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(
      localRight, input.pitch * ROTATION_SPEED * dt
    );
    // 本地 Z 轴滚转
    const localForward = new THREE.Vector3(0, 0, -1).applyQuaternion(orient);
    const qRoll = new THREE.Quaternion().setFromAxisAngle(
      localForward, input.roll * ROTATION_SPEED * dt
    );

    orient.multiply(qYaw).multiply(qPitch).multiply(qRoll).normalize();

    // ── 推力加速度 ──
    this.state.boostActive = input.boost;
    const thrustPower = input.boost ? BOOST_POWER : THRUST_POWER;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(orient).normalize();
    const thrustAccel = forward.clone().multiplyScalar(thrustPower);

    // ── 引力加速度（牛顿万有引力，每个小行星独立贡献） ──
    const gravityAccel = new THREE.Vector3();
    for (const asteroid of this.asteroids) {
      const accel = calcGravityAccel(this.state.position, asteroid.position, asteroid.mass);
      gravityAccel.add(accel);
    }

    // ── 阻力（与速度平方成正比，方向相反） ──
    const speed = this.state.velocity.length();
    const dragAccel = this.state.velocity.clone().normalize()
      .multiplyScalar(-DRAG_COEFFICIENT * speed * speed);

    // ── 半隐式欧拉积分 ──
    const totalAccel = thrustAccel.clone().add(gravityAccel).add(dragAccel);
    this.state.velocity.add(totalAccel.clone().multiplyScalar(dt));
    this.state.position.add(this.state.velocity.clone().multiplyScalar(dt));

    // 世界边界
    this.clampToWorld();

    // ── 渲染同步 ──
    this.ship.position.copy(this.state.position);
    this.ship.quaternion.copy(this.state.orientation);

    updateEngineGlow(this.ship, this.state.elapsed);

    if (this.state.invincibleTimer > 0) {
      this.ship.visible = Math.floor(this.state.elapsed * 20) % 2 === 0;
    } else {
      this.ship.visible = true;
    }

    this.animateStars(dt);
    this.animateAsteroids(dt);
    this.checkCollisions();
    this.hud.update(this.state);
  }

  private clampToWorld(): void {
    const half = WORLD_SIZE / 2;
    const p = this.state.position;
    const v = this.state.velocity;
    if (Math.abs(p.x) > half) { p.x = Math.sign(p.x) * half; v.x *= -0.5; }
    if (Math.abs(p.y) > half) { p.y = Math.sign(p.y) * half; v.y *= -0.5; }
    if (Math.abs(p.z) > half) { p.z = Math.sign(p.z) * half; v.z *= -0.5; }
  }

  // ============================================================
  // 动画
  // ============================================================
  private animateStars(dt: number): void {
    for (const star of this.stars) {
      if (star.collected) continue;
      const obj = this.starObjects.get(star.id);
      if (obj) {
        obj.rotation.y += 2 * dt;
        obj.rotation.x += 0.5 * dt;
      }
    }
  }

  private animateAsteroids(dt: number): void {
    for (const asteroid of this.asteroids) {
      const entry = this.asteroidObjects.get(asteroid.id);
      if (entry) {
        entry.group.rotation.x += asteroid.rotationSpeed.x * dt;
        entry.group.rotation.y += asteroid.rotationSpeed.y * dt;
        entry.group.rotation.z += asteroid.rotationSpeed.z * dt;
      }
    }
  }

  // ============================================================
  // 碰撞
  // ============================================================
  private checkCollisions(): void {
    const shipPos = this.state.position;

    for (const star of this.stars) {
      if (star.collected) continue;
      if (shipPos.distanceTo(star.position) < COLLECT_DISTANCE) {
        star.collected = true;
        this.collectStar(star);
      }
    }

    if (this.state.invincibleTimer <= 0) {
      for (const asteroid of this.asteroids) {
        const dist = shipPos.distanceTo(asteroid.position);
        if (dist < asteroid.radius * ASTEROID_COLLIDE_DISTANCE_RATIO) {
          this.hitAsteroid(asteroid);
          break;
        }
      }
    }
  }

  private collectStar(star: StarCollectible): void {
    this.state.score += 10;
    this.state.lives = Math.min(this.state.maxLives, this.state.lives + 1);

    const obj = this.starObjects.get(star.id);
    if (obj) {
      this.ctx.scene.remove(obj);
      this.starObjects.delete(star.id);
    }

    const effect = createCollectEffect(star.position, 0xffd700);
    this.ctx.scene.add(effect);
    this.effects.push({ obj: effect, life: 0.6 });
  }

  private hitAsteroid(asteroid: Asteroid): void {
    this.state.lives--;
    this.state.invincibleTimer = INVINCIBLE_DURATION;

    const away = new THREE.Vector3().copy(this.state.position).sub(asteroid.position).normalize();
    this.state.velocity.add(away.multiplyScalar(25));

    const effect = createCollectEffect(this.state.position.clone(), 0xff3300);
    this.ctx.scene.add(effect);
    this.effects.push({ obj: effect, life: 0.6 });

    this.cameraShake(0.4, 0.3);

    if (this.state.lives <= 0) {
      this.gameOver();
    }
  }

  // ============================================================
  // 相机（四元数取 forward/up）
  // ============================================================
  private updateCamera(dt: number): void {
    const orient = this.state.orientation;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(orient).normalize();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(orient).normalize();

    this.cameraTarget.copy(this.state.position)
      .addScaledVector(forward, -8)
      .addScaledVector(up, 3);

    this.cameraSmoothPos.lerp(this.cameraTarget, 5 * dt);
    this.ctx.camera.position.copy(this.cameraSmoothPos);
    this.ctx.camera.lookAt(this.state.position);
  }

  // ============================================================
  // 特效
  // ============================================================
  private updateEffects(dt: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i];
      effect.life -= dt;
      if (effect.life <= 0) {
        this.ctx.scene.remove(effect.obj);
        effect.obj.geometry.dispose();
        (effect.obj.material as THREE.Material).dispose();
        this.effects.splice(i, 1);
        continue;
      }
      const geo = effect.obj.geometry;
      const pos = geo.attributes.position;
      const velocities = effect.obj.userData.velocities as number[];
      const fade = effect.life / 0.6;
      for (let j = 0; j < pos.count; j++) {
        pos.setX(j, pos.getX(j) + velocities[j * 3] * 0.5);
        pos.setY(j, pos.getY(j) + velocities[j * 3 + 1] * 0.5);
        pos.setZ(j, pos.getZ(j) + velocities[j * 3 + 2] * 0.5);
      }
      pos.needsUpdate = true;
      (effect.obj.material as THREE.PointsMaterial).opacity = fade;
    }
  }

  private cameraShake(duration: number, intensity: number): void {
    const camera = this.ctx.camera;
    const origPos = camera.position.clone();
    const startTime = this.state.elapsed;
    const shake = () => {
      const elapsed = this.state.elapsed - startTime;
      if (elapsed >= duration) { camera.position.copy(origPos); return; }
      const decay = 1 - elapsed / duration;
      camera.position.x = origPos.x + (Math.random() - 0.5) * intensity * decay;
      camera.position.y = origPos.y + (Math.random() - 0.5) * intensity * decay;
      requestAnimationFrame(shake);
    };
    shake();
  }

  // ============================================================
  // 清理
  // ============================================================
  private clearAll(): void {
    for (const obj of this.starObjects.values()) this.ctx.scene.remove(obj);
    for (const entry of this.asteroidObjects.values()) {
      this.ctx.scene.remove(entry.group);
      this.ctx.scene.remove(entry.ring);
    }
    for (const effect of this.effects) {
      this.ctx.scene.remove(effect.obj);
      effect.obj.geometry.dispose();
      (effect.obj.material as THREE.Material).dispose();
    }
    this.effects = [];
    this.starObjects.clear();
    this.asteroidObjects.clear();
    this.stars = [];
    this.asteroids = [];
  }
}

// ============================================================
// 启动
// ============================================================
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
new Game(canvas);