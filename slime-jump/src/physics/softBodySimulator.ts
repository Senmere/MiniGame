import { Vector3 } from 'three';
import { Particle } from './particle';
import { Spring } from './spring';
import { Platform } from '../entities/platform';

export class SoftBodySimulator {
  particles: Particle[];
  springs: Spring[];
  platforms: Platform[];
  gravity: Vector3;
  groundHeight: number;
  groundFriction: number;
  constraintIterations: number;

  constructor() {
    this.particles = [];
    this.springs = [];
    this.platforms = [];
    this.gravity = new Vector3(0, -9.81, 0);
    this.groundHeight = 0;
    this.groundFriction = 0.95;
    this.constraintIterations = 5;
  }

  addParticle(particle: Particle): void {
    this.particles.push(particle);
  }

  removeParticle(particle: Particle): void {
    const index = this.particles.indexOf(particle);
    if (index !== -1) {
      this.particles.splice(index, 1);
    }
  }

  addSpring(spring: Spring): void {
    this.springs.push(spring);
  }

  removeSpring(spring: Spring): void {
    const index = this.springs.indexOf(spring);
    if (index !== -1) {
      this.springs.splice(index, 1);
    }
  }

  setGravity(x: number, y: number, z: number): void {
    this.gravity.set(x, y, z);
  }

  setGroundHeight(height: number): void {
    this.groundHeight = height;
  }

  setGroundFriction(friction: number): void {
    this.groundFriction = friction;
  }

  setConstraintIterations(iterations: number): void {
    this.constraintIterations = iterations;
  }

  addPlatform(platform: Platform): void {
    this.platforms.push(platform);
  }

  removePlatform(platform: Platform): void {
    const index = this.platforms.indexOf(platform);
    if (index !== -1) {
      this.platforms.splice(index, 1);
    }
  }

  setPlatforms(platforms: Platform[]): void {
    this.platforms = platforms;
  }

  clearPlatforms(): void {
    this.platforms = [];
  }

  applyGravity(): void {
    for (const particle of this.particles) {
      particle.addForce(this.gravity.clone().multiplyScalar(particle.mass));
    }
  }

  applySpringForces(): void {
    for (const spring of this.springs) {
      spring.applyForce();
    }
  }

  solveConstraints(): void {
    for (let i = 0; i < this.constraintIterations; i++) {
      for (const spring of this.springs) {
        spring.constrain();
      }
    }
  }

  handleGroundCollision(): void {
    for (const particle of this.particles) {
      if (particle.position.y < this.groundHeight) {
        particle.position.y = this.groundHeight;

        const velocity = particle.getVelocity();
        if (velocity.y < 0) {
          velocity.y *= -0.5;
        }

        velocity.x *= this.groundFriction;
        velocity.z *= this.groundFriction;

        particle.previousPosition.copy(particle.position);
        particle.previousPosition.sub(velocity);
      }
    }
  }

  handlePlatformCollisions(): void {
    for (const particle of this.particles) {
      for (const platform of this.platforms) {
        const platformPos = platform.getPosition();
        const halfWidth = platform.getWidth() / 2;
        const halfDepth = platform.getDepth() / 2;
        const topY = platform.getTopSurfaceY();

        const inXRange = particle.position.x >= platformPos.x - halfWidth && particle.position.x <= platformPos.x + halfWidth;
        const inZRange = particle.position.z >= platformPos.z - halfDepth && particle.position.z <= platformPos.z + halfDepth;

        const wasAbove = particle.previousPosition.y >= topY;
        const isNowBelow = particle.position.y < topY;

        if (inXRange && inZRange && wasAbove && isNowBelow) {
          particle.position.y = topY;

          const velocity = particle.getVelocity();
          if (velocity.y < 0) {
            velocity.y *= -0.3;
          }

          velocity.x *= this.groundFriction;
          velocity.z *= this.groundFriction;

          particle.previousPosition.copy(particle.position);
          particle.previousPosition.sub(velocity);
        }
      }
    }
  }

  isOnAnyPlatform(): boolean {
    for (const particle of this.particles) {
      for (const platform of this.platforms) {
        const platformPos = platform.getPosition();
        const halfWidth = platform.getWidth() / 2;
        const halfDepth = platform.getDepth() / 2;
        const topY = platform.getTopSurfaceY();

        if (particle.position.x >= platformPos.x - halfWidth &&
            particle.position.x <= platformPos.x + halfWidth &&
            particle.position.z >= platformPos.z - halfDepth &&
            particle.position.z <= platformPos.z + halfDepth &&
            Math.abs(particle.position.y - topY) < 0.15) {
          return true;
        }
      }
    }
    return false;
  }

  update(dt: number): void {
    this.applyGravity();
    this.applySpringForces();

    for (const particle of this.particles) {
      particle.update(dt);
    }

    this.solveConstraints();
    this.handlePlatformCollisions();
    this.handleGroundCollision();
  }

  clear(): void {
    this.particles = [];
    this.springs = [];
  }

  createBox(width: number, height: number, depth: number, segments: number = 2): void {
    this.clear();

    const wStep = width / segments;
    const hStep = height / segments;
    const dStep = depth / segments;

    const offsetX = -width / 2;
    const offsetY = height / 2;
    const offsetZ = -depth / segments;

    const particlesMap: Particle[][][] = [];

    for (let i = 0; i <= segments; i++) {
      particlesMap[i] = [];
      for (let j = 0; j <= segments; j++) {
        particlesMap[i][j] = [];
        for (let k = 0; k <= segments; k++) {
          const x = offsetX + i * wStep;
          const y = offsetY - j * hStep;
          const z = offsetZ + k * dStep;
          const particle = new Particle(x, y, z);
          this.addParticle(particle);
          particlesMap[i][j][k] = particle;
        }
      }
    }

    for (let i = 0; i <= segments; i++) {
      for (let j = 0; j <= segments; j++) {
        for (let k = 0; k <= segments; k++) {
          if (i < segments) {
            this.addSpring(new Spring(particlesMap[i][j][k], particlesMap[i + 1][j][k]));
          }
          if (j < segments) {
            this.addSpring(new Spring(particlesMap[i][j][k], particlesMap[i][j + 1][k]));
          }
          if (k < segments) {
            this.addSpring(new Spring(particlesMap[i][j][k], particlesMap[i][j][k + 1]));
          }
        }
      }
    }
  }

  createSphere(radius: number, slices: number = 8, stacks: number = 8): void {
    this.clear();

    const particlesMap: Particle[][] = [];

    for (let i = 0; i <= stacks; i++) {
      particlesMap[i] = [];
      const theta = (i / stacks) * Math.PI;
      const y = radius * Math.cos(theta);
      const radiusAtY = radius * Math.sin(theta);

      for (let j = 0; j < slices; j++) {
        const phi = (j / slices) * Math.PI * 2;
        const x = radiusAtY * Math.cos(phi);
        const z = radiusAtY * Math.sin(phi);
        const particle = new Particle(x, y, z);
        this.addParticle(particle);
        particlesMap[i][j] = particle;
      }
    }

    for (let i = 0; i <= stacks; i++) {
      for (let j = 0; j < slices; j++) {
        const nextJ = (j + 1) % slices;

        this.addSpring(new Spring(particlesMap[i][j], particlesMap[i][nextJ]));

        if (i < stacks) {
          this.addSpring(new Spring(particlesMap[i][j], particlesMap[i + 1][j]));
          this.addSpring(new Spring(particlesMap[i][j], particlesMap[i + 1][nextJ]));
        }
      }
    }
  }
}