import * as THREE from 'three';
import { Slime } from './entities/slime';
import { Player } from './entities/player';
import { Keyboard } from './input/keyboard';
import { Level1 } from './levels/level1';
import { CameraController } from './camera/cameraController';
import { GameStateManager, GameState } from './game/gameState';
import { HUD } from './ui/hud';
import { Menu } from './ui/menu';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 10, 5);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 1024;
directionalLight.shadow.mapSize.height = 1024;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 30;
directionalLight.shadow.camera.left = -15;
directionalLight.shadow.camera.right = 15;
directionalLight.shadow.camera.top = 12;
directionalLight.shadow.camera.bottom = -3;
directionalLight.shadow.bias = -0.001;
scene.add(directionalLight);

const gameState = new GameStateManager();
const hud = new HUD('hud-container');
const menu = new Menu('menu-container');

let level: Level1;
let slime: Slime;
let keyboard: Keyboard;
let player: Player;
let cameraController: CameraController;

function initLevel(): void {
  if (level) {
    level.dispose();
  }
  if (slime) {
    slime.removeFromScene(scene);
    slime.dispose();
  }

  level = new Level1(scene);
  gameState.setTotalCollectibles(level.getCollectibles().length);

  const startPosition = level.getStartPosition();
  slime = new Slime(startPosition);
  slime.setPlatforms(level.getPlatforms());
  slime.addToScene(scene);

  keyboard = new Keyboard();
  player = new Player(slime, keyboard);

  cameraController = new CameraController(camera, slime);

  gameState.reset();

  (window as any).game = { slime, player, keyboard, gameState, level, scene, camera, cameraController };
}

function checkCollectibles(): void {
  const slimePos = slime.getPosition();
  const collectibles = level.getCollectibles();

  collectibles.forEach((collectible) => {
    if (!collectible.isCollected()) {
      const collectiblePos = collectible.getPosition();
      const distance = slimePos.distanceTo(collectiblePos);

      if (distance < 0.8) {
        collectible.collect();
        gameState.addCollectible();
        gameState.addScore(100);
      }
    }
  });
}

function checkObstacles(): boolean {
  const slimePos = slime.getPosition();
  const obstacles = level.getObstacles();

  for (const obstacle of obstacles) {
    const obstaclePos = obstacle.position;
    const distance = slimePos.distanceTo(obstaclePos);

    if (distance < 0.7) {
      return true;
    }
  }

  return false;
}

function checkWinCondition(): boolean {
  const slimePos = slime.getPosition();
  const endPosition = level.getEndPosition();
  const distance = slimePos.distanceTo(endPosition);

  return distance < 1.5;
}

function checkLoseCondition(): boolean {
  const slimePos = slime.getPosition();
  return slimePos.y < -5;
}

function handleStateChange(newState: GameState, prevState: GameState): void {
  switch (newState) {
    case GameState.START:
      hud.hide();
      menu.show('start');
      break;
    case GameState.RUNNING:
      hud.show();
      menu.hide();
      break;
    case GameState.PAUSED:
      menu.show('start');
      break;
    case GameState.WON:
      hud.hide();
      menu.show('win', {
        score: gameState.getScore(),
        collectibles: gameState.getCollectibleCount(),
        totalCollectibles: gameState.getTotalCollectibles(),
      });
      break;
    case GameState.LOST:
      hud.hide();
      menu.show('lose');
      break;
  }
}

gameState.on('onStateChange', handleStateChange);

gameState.on('onScoreChange', (score) => {
  hud.setScore(score);
});

gameState.on('onCollectibleChange', (count) => {
  hud.setCollectibles(count, gameState.getTotalCollectibles());
});

gameState.on('onLevelChange', (level) => {
  hud.setLevel(level);
});

menu.onStart(() => {
  gameState.start();
});

menu.onRestart(() => {
  initLevel();
  gameState.start();
});

menu.onRetry(() => {
  initLevel();
  gameState.start();
});

initLevel();

let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const currentTime = performance.now();
  const dt = Math.min((currentTime - lastTime) / 1000, 0.05);
  lastTime = currentTime;

  if (gameState.isRunning()) {
    player.update(dt);
    slime.update(dt);
    level.update(dt);

    checkCollectibles();

    if (checkObstacles()) {
      gameState.lose();
    } else if (checkWinCondition()) {
      gameState.win();
    } else if (checkLoseCondition()) {
      gameState.lose();
    }

    cameraController.update();
  }

  renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'p' || event.key === 'P') {
    if (gameState.isRunning()) {
      gameState.pause();
    } else if (gameState.isPaused()) {
      gameState.resume();
    }
  }

  if (event.key === 'Escape') {
    if (!gameState.isGameOver()) {
      gameState.goToStart();
    }
  }
});