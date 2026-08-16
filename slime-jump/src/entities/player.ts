import * as THREE from 'three';
import { Slime } from './slime';
import { Keyboard } from '../input/keyboard';
import { Particle } from '../physics/particle';
import { SoftBodySimulator } from '../physics/softBodySimulator';

export class Player {
  private slime: Slime;
  private keyboard: Keyboard;
  private maxSpeed: number;
  private acceleration: number;
  private friction: number;
  private jumpForce: number;

  constructor(slime: Slime, keyboard: Keyboard) {
    this.slime = slime;
    this.keyboard = keyboard;
    this.maxSpeed = 6;
    this.acceleration = 40;
    this.friction = 0.92;
    this.jumpForce = 10;
  }

  update(dt: number): void {
    this.handleMovement(dt);
    this.handleJump();
  }

  private handleMovement(dt: number): void {
    const particles = this.slime.getParticles();
    const centerParticle = particles[particles.length - 1];
    const currentVelocity = centerParticle.getVelocity();

    let horizontalForce = 0;

    if (this.keyboard.isLeftPressed()) {
      horizontalForce -= this.acceleration;
    }
    if (this.keyboard.isRightPressed()) {
      horizontalForce += this.acceleration;
    }

    if (horizontalForce !== 0) {
      const force = new THREE.Vector3(horizontalForce * dt, 0, 0);
      centerParticle.addForce(force);

      for (const particle of particles) {
        if (!particle.pinned) {
          particle.addForce(force.clone().multiplyScalar(0.3));
        }
      }
    } else {
      const frictionForce = new THREE.Vector3(-currentVelocity.x * this.friction, 0, 0);
      centerParticle.addForce(frictionForce);
    }

    const newVelocity = centerParticle.getVelocity();
    if (Math.abs(newVelocity.x) > this.maxSpeed) {
      const clampedVelocity = new THREE.Vector3(
        Math.sign(newVelocity.x) * this.maxSpeed,
        newVelocity.y,
        newVelocity.z
      );
      centerParticle.setVelocity(clampedVelocity.x, clampedVelocity.y, clampedVelocity.z);
    }
  }

  private handleJump(): void {
    if (this.keyboard.isJumpPressed() && this.isOnGround()) {
      this.slime.jump(this.jumpForce);
    }
  }

  isOnGround(): boolean {
    const simulator = this.slime.getSimulator();
    const groundHeight = simulator.groundHeight;
    const particles = this.slime.getParticles();

    const minY = Math.min(...particles.map(p => p.position.y));
    const onGround = minY <= groundHeight + 0.1;
    const onPlatform = simulator.isOnAnyPlatform();

    return onGround || onPlatform;
  }

  getSlime(): Slime {
    return this.slime;
  }
}