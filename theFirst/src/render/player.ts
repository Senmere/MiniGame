// 玩家飞船 - 程序化 3D 模型

import * as THREE from 'three';

export function createPlayerShip(): THREE.Group {
  const group = new THREE.Group();

  // 材质
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x4488cc,
    roughness: 0.3,
    metalness: 0.7,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x66bbff,
    roughness: 0.2,
    metalness: 0.8,
    emissive: 0x113355,
    emissiveIntensity: 0.4,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xff8800,
    roughness: 0.1,
    metalness: 0.3,
    emissive: 0xff4400,
    emissiveIntensity: 1.5,
  });

  // 主体 - 扁平梭形
  const bodyGeo = new THREE.CylinderGeometry(0.15, 0.5, 2.0, 8, 4);
  bodyGeo.rotateX(Math.PI / 2);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.z = -0.2;
  group.add(body);

  // 机头
  const noseGeo = new THREE.ConeGeometry(0.28, 0.8, 8, 4);
  noseGeo.rotateX(-Math.PI / 2);
  const nose = new THREE.Mesh(noseGeo, accentMat);
  nose.position.z = -1.2;
  group.add(nose);

  // 左翼
  const wingGeo = new THREE.BoxGeometry(0.08, 0.08, 1.2);
  const leftWing = new THREE.Mesh(wingGeo, accentMat);
  leftWing.position.set(-0.55, 0, -0.1);
  leftWing.rotation.z = 0.25;
  group.add(leftWing);

  // 右翼
  const rightWing = new THREE.Mesh(wingGeo, accentMat);
  rightWing.position.set(0.55, 0, -0.1);
  rightWing.rotation.z = -0.25;
  group.add(rightWing);

  // 尾翼（上）
  const tailGeo = new THREE.BoxGeometry(0.06, 0.5, 0.5);
  const tailTop = new THREE.Mesh(tailGeo, accentMat);
  tailTop.position.set(0, 0.3, 0.7);
  group.add(tailTop);

  // 尾翼（下）
  const tailBottom = new THREE.Mesh(tailGeo, accentMat);
  tailBottom.position.set(0, -0.3, 0.7);
  group.add(tailBottom);

  // 引擎发光
  const engineGeo = new THREE.SphereGeometry(0.13, 8, 8);
  const leftEngine = new THREE.Mesh(engineGeo, glowMat);
  leftEngine.position.set(-0.28, 0, 0.8);
  group.add(leftEngine);

  const rightEngine = new THREE.Mesh(engineGeo, glowMat);
  rightEngine.position.set(0.28, 0, 0.8);
  group.add(rightEngine);

  // 引擎粒子光环
  const ringGeo = new THREE.TorusGeometry(0.15, 0.03, 8, 12);
  const leftRing = new THREE.Mesh(ringGeo, glowMat);
  leftRing.position.copy(leftEngine.position);
  group.add(leftRing);

  const rightRing = new THREE.Mesh(ringGeo, glowMat);
  rightRing.position.copy(rightEngine.position);
  group.add(rightRing);

  // 驾驶舱
  const cockpitGeo = new THREE.SphereGeometry(0.22, 8, 8);
  const cockpitMat = new THREE.MeshStandardMaterial({
    color: 0x88ccff,
    roughness: 0.1,
    metalness: 0.2,
    emissive: 0x224466,
    emissiveIntensity: 0.6,
    opacity: 0.7,
    transparent: true,
  });
  const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
  cockpit.position.set(0, 0.1, -0.5);
  cockpit.scale.set(1, 0.6, 0.8);
  group.add(cockpit);

  return group;
}

// 引擎发光动画
export function updateEngineGlow(ship: THREE.Group, time: number): void {
  const pulse = 1 + Math.sin(time * 10) * 0.2 + Math.sin(time * 17) * 0.1;
  ship.children.forEach((child) => {
    if (child instanceof THREE.Mesh) {
      const mat = child.material as THREE.MeshStandardMaterial;
      if (mat.emissive && mat.emissive.getHex() === 0xff4400) {
        mat.emissiveIntensity = 1.5 * pulse;
      }
    }
  });
}