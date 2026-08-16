import * as THREE from 'three';

export class Platform {
  private mesh: THREE.Mesh;
  private position: THREE.Vector3;
  private width: number;
  private height: number;
  private depth: number;
  private material: THREE.MeshStandardMaterial;

  constructor(position: THREE.Vector3, width: number = 4, height: number = 0.3, depth: number = 1) {
    this.position = position.clone();
    this.width = width;
    this.height = height;
    this.depth = depth;

    const geometry = new THREE.BoxGeometry(width, height, depth);
    this.material = new THREE.MeshStandardMaterial({
      color: 0xff9800,
      roughness: 0.6,
      metalness: 0.1,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.copy(position);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
  }

  setColor(color: number): void {
    this.material.color.setHex(color);
  }

  setMaterial(material: THREE.MeshStandardMaterial): void {
    this.material = material;
    this.mesh.material = material;
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

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  getDepth(): number {
    return this.depth;
  }

  getTopSurfaceY(): number {
    return this.position.y + this.height / 2;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}