import * as THREE from 'three';
import { Platform } from '../entities/platform';
import { Collectible } from '../entities/collectible';

export class Level1 {
  private platforms: Platform[] = [];
  private collectibles: Collectible[] = [];
  private obstacles: THREE.Mesh[] = [];
  private decorations: THREE.Object3D[] = [];
  private ground!: THREE.Mesh;
  private startPosition: THREE.Vector3;
  private endPosition: THREE.Vector3;
  private endPlatform!: Platform;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.startPosition = new THREE.Vector3(-8, 1, 0);
    this.endPosition = new THREE.Vector3(18, 8, 0);

    this.createGround();
    this.createPlatforms();
    this.createObstacles();
    this.createCollectibles();
    this.createEnvironmentDecorations();

    this.addToScene();
  }

  private createGround(): void {
    const geometry = new THREE.PlaneGeometry(100, 20);
    const material = new THREE.MeshStandardMaterial({
      color: 0x4caf50,
      roughness: 0.8,
      metalness: 0.2,
    });

    this.ground = new THREE.Mesh(geometry, material);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = 0;
    this.ground.receiveShadow = true;
  }

  private createPlatforms(): void {
    const platformConfigs = [
      { x: -6, y: 1.5, width: 4, color: 0xff9800 },
      { x: -2, y: 2.5, width: 3, color: 0xff9800 },
      { x: 2, y: 3.5, width: 4, color: 0xff9800 },
      { x: 6, y: 4.5, width: 3, color: 0xff9800 },
      { x: 10, y: 5.5, width: 4, color: 0xff9800 },
      { x: 14, y: 6.5, width: 3, color: 0xff9800 },
      { x: 18, y: 7.5, width: 5, color: 0x4caf50 },
    ];

    platformConfigs.forEach((config) => {
      const platform = new Platform(new THREE.Vector3(config.x, config.y, 0), config.width);
      platform.setColor(config.color);
      this.platforms.push(platform);
    });

    this.endPlatform = this.platforms[this.platforms.length - 1];
  }

  private createObstacles(): void {
    const spikePositions = [
      { x: -0.5, y: 2.65, rotation: 0 },
      { x: 7, y: 4.65, rotation: Math.PI / 4 },
      { x: 15, y: 6.65, rotation: Math.PI / 2 },
    ];

    spikePositions.forEach((pos) => {
      const spikeGeometry = new THREE.ConeGeometry(0.3, 0.5, 4);
      const spikeMaterial = new THREE.MeshStandardMaterial({
        color: 0x424242,
        roughness: 0.8,
        metalness: 0.3,
      });

      const spike = new THREE.Mesh(spikeGeometry, spikeMaterial);
      spike.position.set(pos.x, pos.y, 0);
      spike.rotation.y = pos.rotation;
      spike.castShadow = true;

      this.obstacles.push(spike);
    });

    const movingObstacleGeometry = new THREE.BoxGeometry(0.8, 0.4, 0.8);
    const movingObstacleMaterial = new THREE.MeshStandardMaterial({
      color: 0xf44336,
      roughness: 0.5,
      metalness: 0.2,
      emissive: 0xf44336,
      emissiveIntensity: 0.3,
    });

    const movingObstacle = new THREE.Mesh(movingObstacleGeometry, movingObstacleMaterial);
    movingObstacle.position.set(12, 5.7, 0);
    movingObstacle.userData = {
      originalY: 5.7,
      amplitude: 0.8,
      speed: 2,
      time: 0,
    };
    movingObstacle.castShadow = true;

    this.obstacles.push(movingObstacle);
  }

  private createCollectibles(): void {
    const collectibleConfigs = [
      { x: -5, y: 2.5, type: 'star' as const },
      { x: 0, y: 3.5, type: 'coin' as const },
      { x: 3.5, y: 4.5, type: 'star' as const },
      { x: 8, y: 5.5, type: 'coin' as const },
      { x: 12, y: 6.5, type: 'star' as const },
      { x: 16, y: 7.5, type: 'coin' as const },
      { x: 18, y: 8.5, type: 'star' as const },
    ];

    collectibleConfigs.forEach((config) => {
      const collectible = new Collectible(new THREE.Vector3(config.x, config.y, 0), config.type);
      this.collectibles.push(collectible);
    });
  }

  private createEnvironmentDecorations(): void {
    this.createGrass();
    this.createTrees();
    this.createClouds();
    this.createFlowers();
  }

  private createGrass(): void {
    const grassGeometry = new THREE.ConeGeometry(0.05, 0.3, 4);
    const grassMaterial = new THREE.MeshStandardMaterial({
      color: 0x388e3c,
      roughness: 0.9,
      metalness: 0,
    });

    const grassCount = 50;
    const grassMesh = new THREE.InstancedMesh(grassGeometry, grassMaterial, grassCount);
    grassMesh.castShadow = true;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < grassCount; i++) {
      dummy.position.set(
        -25 + Math.random() * 50,
        0.15,
        -5 + Math.random() * 10
      );
      dummy.rotation.y = Math.random() * Math.PI * 2;
      const scaleY = 0.5 + Math.random() * 0.8;
      dummy.scale.set(1, scaleY, 1);
      dummy.updateMatrix();
      grassMesh.setMatrixAt(i, dummy.matrix);
    }

    this.decorations.push(grassMesh);
  }

  private createTrees(): void {
    const treePositions = [
      { x: -12, z: 3, scale: 1 },
      { x: -8, z: -3, scale: 0.8 },
      { x: -3, z: 3, scale: 1.2 },
      { x: 5, z: -3, scale: 0.9 },
      { x: 12, z: 3, scale: 1.1 },
      { x: 20, z: -3, scale: 1 },
    ];

    treePositions.forEach((pos) => {
      const trunkGeometry = new THREE.CylinderGeometry(0.3, 0.4, 1.5, 8);
      const trunkMaterial = new THREE.MeshStandardMaterial({
        color: 0x8d6e63,
        roughness: 0.8,
        metalness: 0.1,
      });
      const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
      trunk.position.set(pos.x, 0.75, pos.z);

      const leavesGeometry = new THREE.ConeGeometry(1.2, 3, 8);
      const leavesMaterial = new THREE.MeshStandardMaterial({
        color: 0x2e7d32,
        roughness: 0.7,
        metalness: 0,
      });
      const leaves = new THREE.Mesh(leavesGeometry, leavesMaterial);
      leaves.position.set(pos.x, 2.5, pos.z);

      const treeGroup = new THREE.Group();
      treeGroup.add(trunk);
      treeGroup.add(leaves);
      treeGroup.scale.set(pos.scale, pos.scale, pos.scale);

      this.decorations.push(treeGroup);
    });
  }

  private createClouds(): void {
    const cloudPositions = [
      { x: -15, y: 8, z: -2 },
      { x: -5, y: 10, z: -1 },
      { x: 5, y: 9, z: -2 },
      { x: 15, y: 11, z: -1 },
      { x: 25, y: 8, z: -2 },
    ];

    const cloudMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0,
      transparent: true,
      opacity: 0.9,
    });

    const cloudSizes = [1.2, 1, 0.8, 1, 0.9];
    const cloudOffsets = [
      { x: 0, y: 0 },
      { x: -0.8, y: 0.2 },
      { x: 0.8, y: 0.1 },
      { x: -0.5, y: -0.3 },
      { x: 0.5, y: -0.2 },
    ];

    const cloudPartsCount = cloudPositions.length * cloudSizes.length;
    const cloudGeometry = new THREE.SphereGeometry(1, 16, 16);
    const cloudMesh = new THREE.InstancedMesh(cloudGeometry, cloudMaterial, cloudPartsCount);

    const dummy = new THREE.Object3D();
    let instanceIndex = 0;

    cloudPositions.forEach((pos) => {
      cloudSizes.forEach((size, index) => {
        dummy.position.set(
          pos.x + cloudOffsets[index].x,
          pos.y + cloudOffsets[index].y,
          pos.z
        );
        dummy.scale.set(size, size, size);
        dummy.updateMatrix();
        cloudMesh.setMatrixAt(instanceIndex, dummy.matrix);
        instanceIndex++;
      });
    });

    cloudMesh.userData = {
      cloudPositions,
      cloudSizes,
      cloudOffsets,
      originalX: cloudPositions[0].x,
      speed: 0.2,
      isCloud: true,
    };

    this.decorations.push(cloudMesh);
  }

  private createFlowers(): void {
    const flowerPositions = [
      { x: -6, z: 2, color: 0xe91e63 },
      { x: -2, z: -2, color: 0xffeb3b },
      { x: 2, z: 2, color: 0x9c27b0 },
      { x: 8, z: -2, color: 0x00bcd4 },
      { x: 14, z: 2, color: 0xff9800 },
      { x: 18, z: -2, color: 0xe91e63 },
    ];

    flowerPositions.forEach((pos) => {
      const stemGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.4, 4);
      const stemMaterial = new THREE.MeshStandardMaterial({ color: 0x4caf50 });
      const stem = new THREE.Mesh(stemGeometry, stemMaterial);
      stem.position.set(pos.x, 0.2, pos.z);

      const petalGeometry = new THREE.SphereGeometry(0.15, 8, 8);
      const petalMaterial = new THREE.MeshStandardMaterial({ color: pos.color });

      const flowerGroup = new THREE.Group();
      flowerGroup.add(stem);

      for (let i = 0; i < 5; i++) {
        const petal = new THREE.Mesh(petalGeometry, petalMaterial);
        const angle = (i / 5) * Math.PI * 2;
        petal.position.set(
          Math.cos(angle) * 0.12,
          0.35,
          Math.sin(angle) * 0.12
        );
        petal.scale.set(1, 0.6, 1);
        flowerGroup.add(petal);
      }

      const centerGeometry = new THREE.SphereGeometry(0.08, 8, 8);
      const centerMaterial = new THREE.MeshStandardMaterial({ color: 0xffd700 });
      const center = new THREE.Mesh(centerGeometry, centerMaterial);
      center.position.set(0, 0.35, 0);
      flowerGroup.add(center);

      flowerGroup.position.set(pos.x, 0, pos.z);

      this.decorations.push(flowerGroup);
    });
  }

  private addToScene(): void {
    this.scene.add(this.ground);

    this.platforms.forEach((platform) => {
      platform.addToScene(this.scene);
    });

    this.obstacles.forEach((obstacle) => {
      this.scene.add(obstacle);
    });

    this.collectibles.forEach((collectible) => {
      collectible.addToScene(this.scene);
    });

    this.decorations.forEach((decoration) => {
      this.scene.add(decoration);
    });

    this.createEndFlag();
  }

  private createEndFlag(): void {
    const poleGeometry = new THREE.CylinderGeometry(0.05, 0.05, 1.5, 8);
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x795548 });
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.position.set(this.endPosition.x, this.endPosition.y + 1, 0);

    const flagGeometry = new THREE.PlaneGeometry(0.8, 0.6);
    const flagMaterial = new THREE.MeshStandardMaterial({
      color: 0xe91e63,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    const flag = new THREE.Mesh(flagGeometry, flagMaterial);
    flag.position.set(this.endPosition.x + 0.4, this.endPosition.y + 1.3, 0);
    flag.userData = {
      time: 0,
    };

    this.scene.add(pole);
    this.scene.add(flag);
    this.decorations.push(pole);
    this.decorations.push(flag);
  }

  update(dt: number): void {
    this.collectibles.forEach((collectible) => {
      collectible.update(dt);
    });

    this.obstacles.forEach((obstacle) => {
      if (obstacle.userData.originalY !== undefined) {
        obstacle.userData.time += dt;
        obstacle.position.y = obstacle.userData.originalY +
          Math.sin(obstacle.userData.time * obstacle.userData.speed) * obstacle.userData.amplitude;
      }
    });

    const dummy = new THREE.Object3D();

    this.decorations.forEach((decoration) => {
      if (decoration.userData.isCloud && decoration instanceof THREE.InstancedMesh) {
        const { cloudPositions, cloudSizes, cloudOffsets, speed } = decoration.userData;
        let instanceIndex = 0;

        cloudPositions.forEach((pos: { x: number; y: number; z: number }) => {
          const updatedX = pos.x - speed * dt;
          if (updatedX < -30) pos.x = 25;
          else pos.x = updatedX;

          cloudSizes.forEach((size: number, index: number) => {
            dummy.position.set(
              pos.x + cloudOffsets[index].x,
              pos.y + cloudOffsets[index].y,
              pos.z
            );
            dummy.scale.set(size, size, size);
            dummy.updateMatrix();
            decoration.setMatrixAt(instanceIndex, dummy.matrix);
            instanceIndex++;
          });
        });

        decoration.instanceMatrix.needsUpdate = true;
      } else if (decoration.userData.originalX !== undefined) {
        decoration.position.x -= decoration.userData.speed * dt;
        if (decoration.position.x < -30) {
          decoration.position.x = decoration.userData.originalX + 50;
        }
      }

      if (decoration.userData.time !== undefined) {
        decoration.userData.time += dt;
        decoration.rotation.z = Math.sin(decoration.userData.time * 3) * 0.1;
      }
    });
  }

  getPlatforms(): Platform[] {
    return this.platforms;
  }

  getCollectibles(): Collectible[] {
    return this.collectibles;
  }

  getObstacles(): THREE.Mesh[] {
    return this.obstacles;
  }

  getStartPosition(): THREE.Vector3 {
    return this.startPosition.clone();
  }

  getEndPosition(): THREE.Vector3 {
    return this.endPosition.clone();
  }

  getEndPlatform(): Platform {
    return this.endPlatform;
  }

  getGround(): THREE.Mesh {
    return this.ground;
  }

  dispose(): void {
    this.platforms.forEach((platform) => platform.dispose());
    this.collectibles.forEach((collectible) => collectible.dispose());

    this.obstacles.forEach((obstacle) => {
      obstacle.geometry.dispose();
      if (obstacle.material instanceof THREE.Material) {
        obstacle.material.dispose();
      }
    });

    this.decorations.forEach((decoration) => {
      if (decoration instanceof THREE.InstancedMesh) {
        decoration.geometry.dispose();
        if (decoration.material instanceof THREE.Material) {
          decoration.material.dispose();
        }
      } else {
        decoration.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (child.material instanceof THREE.Material) {
              child.material.dispose();
            }
          }
        });
      }
    });

    this.ground.geometry.dispose();
    if (this.ground.material instanceof THREE.Material) {
      this.ground.material.dispose();
    }
  }
}