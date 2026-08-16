import * as THREE from 'three';
import { Particle } from '../physics/particle';
import { Spring } from '../physics/spring';
import { SoftBodySimulator } from '../physics/softBodySimulator';
import { Platform } from './platform';

export class Slime {
  private simulator: SoftBodySimulator;
  private mesh: THREE.Mesh | null = null;
  private eyeLeft: THREE.Mesh | null = null;
  private eyeRight: THREE.Mesh | null = null;
  private mouth: THREE.Mesh | null = null;
  private faceGroup: THREE.Group | null = null;
  private particles: Particle[];
  private springs: Spring[];
  private baseGeometry: THREE.SphereGeometry | null = null;
  private centroid: THREE.Vector3;
  private originalVertexPositions: Float32Array | null = null;
  private isJumping: boolean;

  constructor(position: THREE.Vector3 = new THREE.Vector3(0, 1, 0)) {
    this.simulator = new SoftBodySimulator();
    this.simulator.setGravity(0, -12, 0);
    this.simulator.setGroundHeight(0);
    this.simulator.setConstraintIterations(4);
    this.particles = [];
    this.springs = [];
    this.centroid = new THREE.Vector3();
    this.isJumping = false;

    this.initParticles(17);
    this.initSprings();
    this.initMesh();
    this.initFace();

    for (const particle of this.particles) {
      particle.position.add(position);
      particle.previousPosition.add(position);
    }
  }

  private initParticles(count: number): void {
    const radius = 0.6;
    const particlesMap: Particle[][] = [];
    const stacks = 3;
    const slices = 4;

    for (let i = 0; i <= stacks; i++) {
      particlesMap[i] = [];
      const theta = (i / stacks) * Math.PI;
      const y = radius * Math.cos(theta);
      const radiusAtY = radius * Math.sin(theta);

      for (let j = 0; j < slices; j++) {
        const phi = (j / slices) * Math.PI * 2;
        const x = radiusAtY * Math.cos(phi);
        const z = radiusAtY * Math.sin(phi);
        const particle = new Particle(x, y, z, 0.5);
        this.particles.push(particle);
        particlesMap[i][j] = particle;
      }
    }

    const centerParticle = new Particle(0, 0, 0, 1);
    this.particles.push(centerParticle);

    for (let i = 0; i <= stacks; i++) {
      for (let j = 0; j < slices; j++) {
        const nextJ = (j + 1) % slices;

        if (i < stacks) {
          this.springs.push(new Spring(particlesMap[i][j], particlesMap[i + 1][j], 100, 0.2));
          this.springs.push(new Spring(particlesMap[i][j], particlesMap[i + 1][nextJ], 75, 0.15));
        }

        this.springs.push(new Spring(particlesMap[i][j], particlesMap[i][nextJ], 85, 0.15));
        this.springs.push(new Spring(particlesMap[i][j], centerParticle, 60, 0.1));
      }
    }

    for (const particle of this.particles) {
      this.simulator.addParticle(particle);
    }
    for (const spring of this.springs) {
      this.simulator.addSpring(spring);
    }
  }

  private initSprings(): void {}

  private initMesh(): void {
    this.baseGeometry = new THREE.SphereGeometry(0.6, 32, 32);
    this.originalVertexPositions = new Float32Array(this.baseGeometry.attributes.position.count * 3);
    const positionArray = this.baseGeometry.attributes.position.array as Float32Array;
    this.originalVertexPositions.set(positionArray);

    const jellyShader = {
      uniforms: {
        color: { value: new THREE.Color(0x4fc3f7) },
        edgeColor: { value: new THREE.Color(0x81d4fa) },
        glowIntensity: { value: 0.8 },
        transparency: { value: 0.6 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vViewPosition = -mvPosition.xyz;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform vec3 edgeColor;
        uniform float glowIntensity;
        uniform float transparency;
        
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        
        void main() {
          vec3 normal = normalize(vNormal);
          vec3 viewDir = normalize(vViewPosition);
          
          float rim = 1.0 - max(dot(normal, viewDir), 0.0);
          rim = pow(rim, 2.0);
          
          vec3 finalColor = mix(color, edgeColor, rim * glowIntensity);
          float alpha = transparency + rim * (1.0 - transparency);
          
          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
    };

    const material = new THREE.ShaderMaterial({
      uniforms: jellyShader.uniforms,
      vertexShader: jellyShader.vertexShader,
      fragmentShader: jellyShader.fragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(this.baseGeometry, material);
  }

  private initFace(): void {
    this.faceGroup = new THREE.Group();

    const eyeGeometry = new THREE.SphereGeometry(0.12, 16, 16);
    const eyeWhiteMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const eyeBlackMaterial = new THREE.MeshBasicMaterial({ color: 0x1a237e });

    this.eyeLeft = new THREE.Mesh(eyeGeometry, eyeWhiteMaterial);
    this.eyeLeft.position.set(-0.25, 0.15, 0.5);

    const pupilLeft = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), eyeBlackMaterial);
    pupilLeft.position.set(0, 0, 0.08);
    this.eyeLeft.add(pupilLeft);

    this.eyeRight = new THREE.Mesh(eyeGeometry, eyeWhiteMaterial);
    this.eyeRight.position.set(0.25, 0.15, 0.5);

    const pupilRight = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), eyeBlackMaterial);
    pupilRight.position.set(0, 0, 0.08);
    this.eyeRight.add(pupilRight);

    const mouthShape = new THREE.Shape();
    mouthShape.moveTo(-0.15, 0);
    mouthShape.quadraticCurveTo(-0.15, -0.1, 0, -0.12);
    mouthShape.quadraticCurveTo(0.15, -0.1, 0.15, 0);

    const mouthGeometry = new THREE.ExtrudeGeometry(mouthShape, {
      depth: 0.05,
      bevelEnabled: false,
    });

    const mouthMaterial = new THREE.MeshBasicMaterial({ color: 0x0d47a1 });
    this.mouth = new THREE.Mesh(mouthGeometry, mouthMaterial);
    this.mouth.position.set(0, -0.1, 0.5);
    this.mouth.rotation.x = Math.PI;

    if (this.faceGroup && this.eyeLeft && this.eyeRight && this.mouth) {
      this.faceGroup.add(this.eyeLeft);
      this.faceGroup.add(this.eyeRight);
      this.faceGroup.add(this.mouth);
    }
  }

  jump(force: number = 8): void {
    if (this.isJumping) return;

    const centerParticle = this.particles[this.particles.length - 1];
    centerParticle.addForce(new THREE.Vector3(0, force * 60, 0));

    for (const particle of this.particles) {
      if (!particle.pinned) {
        particle.addForce(new THREE.Vector3(0, force * 30, 0));
      }
    }

    this.isJumping = true;
  }

  update(dt: number): void {
    this.simulator.update(dt);
    this.updateMeshVertices();
    this.updateFacePosition();
    this.updateCentroid();

    const groundHeight = this.simulator.groundHeight;
    const minY = Math.min(...this.particles.map(p => p.position.y));
    if (minY <= groundHeight + 0.05) {
      this.isJumping = false;
    }
  }

  private updateMeshVertices(): void {
    if (!this.baseGeometry) return;
    
    const positions = this.baseGeometry.attributes.position;
    const particlePositions = this.particles.slice(0, -1).map(p => p.position);
    const centerParticle = this.particles[this.particles.length - 1];

    for (let i = 0; i < positions.count; i++) {
      if (!this.originalVertexPositions) continue;
      
      const originalX = this.originalVertexPositions[i * 3];
      const originalY = this.originalVertexPositions[i * 3 + 1];
      const originalZ = this.originalVertexPositions[i * 3 + 2];

      const originalNormal = new THREE.Vector3(originalX, originalY, originalZ).normalize();
      const closestParticle = this.findClosestParticle(originalNormal, particlePositions);

      if (closestParticle) {
        const centerPos = centerParticle.position;
        const direction = closestParticle.clone().sub(centerPos).normalize();
        const distance = closestParticle.distanceTo(centerPos);

        positions.setXYZ(i, centerPos.x + direction.x * distance, centerPos.y + direction.y * distance, centerPos.z + direction.z * distance);
      }
    }

    positions.needsUpdate = true;
    this.baseGeometry.computeVertexNormals();
  }

  private findClosestParticle(direction: THREE.Vector3, particles: THREE.Vector3[]): THREE.Vector3 | null {
    let closest: THREE.Vector3 | null = null;
    let maxDot = -Infinity;

    for (const particle of particles) {
      const particleDir = particle.clone().normalize();
      const dot = direction.dot(particleDir);
      if (dot > maxDot) {
        maxDot = dot;
        closest = particle;
      }
    }

    return closest;
  }

  private updateFacePosition(): void {
    if (!this.faceGroup) return;

    const centerParticle = this.particles[this.particles.length - 1];
    this.faceGroup.position.copy(centerParticle.position);
  }

  private updateCentroid(): void {
    this.centroid.set(0, 0, 0);
    for (const particle of this.particles) {
      this.centroid.add(particle.position);
    }
    this.centroid.divideScalar(this.particles.length);
  }

  getPosition(): THREE.Vector3 {
    return this.centroid.clone();
  }

  getMesh(): THREE.Mesh {
    return this.mesh!;
  }

  getFaceGroup(): THREE.Group {
    return this.faceGroup!;
  }

  getParticles(): Particle[] {
    return this.particles;
  }

  getSimulator(): SoftBodySimulator {
    return this.simulator;
  }

  setPlatforms(platforms: Platform[]): void {
    this.simulator.setPlatforms(platforms);
  }

  addToScene(scene: THREE.Scene): void {
    if (this.mesh) scene.add(this.mesh);
    if (this.faceGroup) scene.add(this.faceGroup);
  }

  removeFromScene(scene: THREE.Scene): void {
    if (this.mesh) scene.remove(this.mesh);
    if (this.faceGroup) scene.remove(this.faceGroup);
  }

  dispose(): void {
    if (this.baseGeometry) this.baseGeometry.dispose();
    if (this.mesh && this.mesh.material instanceof THREE.ShaderMaterial) {
      this.mesh.material.dispose();
    }
    this.simulator.clear();
  }
}