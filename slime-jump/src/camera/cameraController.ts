import * as THREE from 'three';
import { Slime } from '../entities/slime';

export class CameraController {
  private camera: THREE.Camera;
  private slime: Slime;
  private targetPosition: THREE.Vector3;
  private followSpeed: number;
  private cameraHeight: number;
  private cameraDistance: number;
  private angle: number;
  private leftBoundary: number;
  private rightBoundary: number;

  constructor(camera: THREE.Camera, slime: Slime) {
    this.camera = camera;
    this.slime = slime;
    this.targetPosition = new THREE.Vector3();
    this.followSpeed = 0.08;
    this.cameraHeight = 8;
    this.cameraDistance = 12;
    this.angle = Math.PI / 4;
    this.leftBoundary = -15;
    this.rightBoundary = 25;

    this.initializeCamera();
  }

  private initializeCamera(): void {
    const slimePos = this.slime.getPosition();
    const cameraX = slimePos.x + Math.sin(this.angle) * this.cameraDistance;
    const cameraZ = -Math.cos(this.angle) * this.cameraDistance;
    
    this.camera.position.set(cameraX, this.cameraHeight, cameraZ);
    this.camera.lookAt(slimePos.x, slimePos.y + 0.5, 0);
  }

  setFollowSpeed(speed: number): void {
    this.followSpeed = Math.max(0.01, Math.min(1, speed));
  }

  setCameraHeight(height: number): void {
    this.cameraHeight = Math.max(3, height);
  }

  setCameraDistance(distance: number): void {
    this.cameraDistance = Math.max(5, distance);
  }

  setBoundary(left: number, right: number): void {
    this.leftBoundary = left;
    this.rightBoundary = right;
  }

  update(): void {
    const slimePos = this.slime.getPosition();

    const idealX = slimePos.x + Math.sin(this.angle) * this.cameraDistance;
    const clampedX = Math.max(this.leftBoundary, Math.min(this.rightBoundary, idealX));

    this.targetPosition.x = clampedX;
    this.targetPosition.y = this.cameraHeight;
    this.targetPosition.z = -Math.cos(this.angle) * this.cameraDistance;

    this.camera.position.lerp(this.targetPosition, this.followSpeed);

    const lookAtY = Math.min(slimePos.y + 0.5, this.cameraHeight - 2);
    this.camera.lookAt(slimePos.x, lookAtY, 0);
  }

  getCamera(): THREE.Camera {
    return this.camera;
  }
}