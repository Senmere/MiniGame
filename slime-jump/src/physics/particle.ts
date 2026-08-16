import { Vector3 } from 'three';

export class Particle {
  position: Vector3;
  previousPosition: Vector3;
  acceleration: Vector3;
  mass: number;
  pinned: boolean;

  constructor(x: number = 0, y: number = 0, z: number = 0, mass: number = 1) {
    this.position = new Vector3(x, y, z);
    this.previousPosition = new Vector3(x, y, z);
    this.acceleration = new Vector3(0, 0, 0);
    this.mass = mass;
    this.pinned = false;
  }

  addForce(force: Vector3): void {
    this.acceleration.addScaledVector(force, 1 / this.mass);
  }

  update(dt: number): void {
    if (this.pinned) {
      this.acceleration.set(0, 0, 0);
      return;
    }

    const dtSquared = dt * dt;
    const temp = new Vector3().copy(this.position);

    this.position.addScaledVector(
      this.position.clone().sub(this.previousPosition),
      1
    );
    this.position.addScaledVector(this.acceleration, dtSquared);

    this.previousPosition.copy(temp);
    this.acceleration.set(0, 0, 0);
  }

  getVelocity(): Vector3 {
    return this.position.clone().sub(this.previousPosition);
  }

  setVelocity(vx: number, vy: number, vz: number): void {
    this.previousPosition.copy(this.position);
    this.previousPosition.sub(new Vector3(vx, vy, vz));
  }

  pin(): void {
    this.pinned = true;
  }

  unpin(): void {
    this.pinned = false;
  }
}