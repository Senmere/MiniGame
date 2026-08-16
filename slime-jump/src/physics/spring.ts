import { Vector3 } from 'three';
import { Particle } from './particle';

export class Spring {
  particle1: Particle;
  particle2: Particle;
  restLength: number;
  stiffness: number;
  damping: number;

  constructor(p1: Particle, p2: Particle, stiffness: number = 100, damping: number = 0.1) {
    this.particle1 = p1;
    this.particle2 = p2;
    this.restLength = p1.position.distanceTo(p2.position);
    this.stiffness = stiffness;
    this.damping = damping;
  }

  applyForce(): void {
    const delta = new Vector3().subVectors(this.particle2.position, this.particle1.position);
    const currentLength = delta.length();
    
    if (currentLength === 0) return;

    const forceDirection = delta.clone().normalize();
    const displacement = currentLength - this.restLength;

    const velocity1 = this.particle1.getVelocity();
    const velocity2 = this.particle2.getVelocity();
    const relativeVelocity = velocity2.clone().sub(velocity1);
    const dampingForce = relativeVelocity.dot(forceDirection) * this.damping;

    const springForce = (this.stiffness * displacement + dampingForce) * -1;

    const force = forceDirection.clone().multiplyScalar(springForce);

    this.particle1.addForce(force);
    this.particle2.addForce(force.clone().multiplyScalar(-1));
  }

  constrain(): void {
    const delta = new Vector3().subVectors(this.particle2.position, this.particle1.position);
    const currentLength = delta.length();
    
    if (currentLength === 0) return;

    const forceDirection = delta.clone().normalize();
    const displacement = currentLength - this.restLength;

    const totalMass = this.particle1.mass + this.particle2.mass;
    const ratio1 = this.particle2.mass / totalMass;
    const ratio2 = this.particle1.mass / totalMass;

    if (!this.particle1.pinned) {
      this.particle1.position.addScaledVector(forceDirection, displacement * ratio1);
    }
    if (!this.particle2.pinned) {
      this.particle2.position.addScaledVector(forceDirection, -displacement * ratio2);
    }
  }

  getCurrentLength(): number {
    return this.particle1.position.distanceTo(this.particle2.position);
  }

  setRestLength(length: number): void {
    this.restLength = length;
  }

  setStiffness(stiffness: number): void {
    this.stiffness = stiffness;
  }

  setDamping(damping: number): void {
    this.damping = damping;
  }
}