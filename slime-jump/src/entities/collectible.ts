import * as THREE from 'three';

export type CollectibleType = 'star' | 'coin';

export class Collectible {
  private mesh: THREE.Mesh;
  private position: THREE.Vector3;
  private type: CollectibleType;
  private collected: boolean;
  private rotationSpeed: number;
  private floatOffset: number;
  private baseY: number;

  constructor(position: THREE.Vector3, type: CollectibleType = 'star') {
    this.position = position.clone();
    this.type = type;
    this.collected = false;
    this.rotationSpeed = 2 + Math.random() * 2;
    this.floatOffset = Math.random() * Math.PI * 2;
    this.baseY = position.y;

    let geometry: THREE.BufferGeometry;
    let material: THREE.MeshStandardMaterial;

    if (type === 'star') {
      geometry = this.createStarGeometry();
      material = new THREE.MeshStandardMaterial({
        color: 0xffeb3b,
        roughness: 0.2,
        metalness: 0.6,
        emissive: 0xffeb3b,
        emissiveIntensity: 0.5,
      });
    } else {
      geometry = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 32);
      material = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        roughness: 0.3,
        metalness: 0.7,
        emissive: 0xffd700,
        emissiveIntensity: 0.3,
      });
    }

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(position);
    this.mesh.castShadow = true;
  }

  private createStarGeometry(): THREE.BufferGeometry {
    const points: THREE.Vector2[] = [];
    const outerRadius = 0.4;
    const innerRadius = 0.2;
    const spikes = 5;

    for (let i = 0; i < spikes * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i * Math.PI) / spikes;
      points.push(new THREE.Vector2(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius
      ));
    }

    const shape = new THREE.Shape(points);
    const extrudeSettings = {
      depth: 0.15,
      bevelEnabled: false,
    };

    return new THREE.ExtrudeGeometry(shape, extrudeSettings);
  }

  update(dt: number): void {
    if (this.collected) return;

    this.mesh.rotation.y += this.rotationSpeed * dt;
    this.floatOffset += dt * 2;
    this.mesh.position.y = this.baseY + Math.sin(this.floatOffset) * 0.15;
  }

  collect(): void {
    this.collected = true;
    this.mesh.visible = false;
  }

  isCollected(): boolean {
    return this.collected;
  }

  addToScene(scene: THREE.Scene): void {
    scene.add(this.mesh);
  }

  removeFromScene(scene: THREE.Scene): void {
    scene.remove(this.mesh);
  }

  getMesh(): THREE.Mesh {
    return this.mesh;
  }

  getPosition(): THREE.Vector3 {
    return this.position.clone();
  }

  getType(): CollectibleType {
    return this.type;
  }

  getRadius(): number {
    return this.type === 'star' ? 0.4 : 0.3;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    if (this.mesh.material instanceof THREE.MeshStandardMaterial) {
      this.mesh.material.dispose();
    }
  }
}