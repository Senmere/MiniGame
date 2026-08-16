// 收集物和障碍物 - 金色星星 + 大型小行星

import * as THREE from 'three';

// 金色星星收集物
export function createStar(): THREE.Group {
  const group = new THREE.Group();

  const starMat = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    roughness: 0.1,
    metalness: 0.5,
    emissive: 0xffaa00,
    emissiveIntensity: 1.2,
  });

  const starShape = createStarShape(0.35, 0.15, 5);
  const extrudeSettings = { depth: 0.1, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3 };
  const starGeo = new THREE.ExtrudeGeometry(starShape, extrudeSettings);
  starGeo.center();
  const starMesh = new THREE.Mesh(starGeo, starMat);
  group.add(starMesh);

  const glowGeo = new THREE.SphereGeometry(0.45, 16, 16);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffdd44,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  group.add(glow);

  return group;
}

function createStarShape(outerR: number, innerR: number, points: number): THREE.Shape {
  const shape = new THREE.Shape();
  const step = Math.PI / points;
  for (let i = 0; i < points * 2; i++) {
    const angle = i * step - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

// 大型小行星（带引力）
export function createAsteroid(radius: number): THREE.Group {
  const group = new THREE.Group();

  const rockMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.08, 0.3, 0.15 + Math.random() * 0.15),
    roughness: 0.8,
    metalness: 0.2,
    flatShading: true,
  });

  // 不规则球体
  const detail = Math.floor(radius * 1.5);
  const geo = new THREE.IcosahedronGeometry(radius, Math.max(1, detail));
  const positions = geo.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const scale = 0.7 + Math.random() * 0.6;
    positions.setXYZ(i, x * scale, y * scale, z * scale);
  }
  geo.computeVertexNormals();
  const rock = new THREE.Mesh(geo, rockMat);
  rock.castShadow = true;
  group.add(rock);

  // 小陨石坑装饰
  const craterCount = Math.floor(radius * 3);
  for (let i = 0; i < craterCount; i++) {
    const craterGeo = new THREE.SphereGeometry(radius * 0.08 + Math.random() * radius * 0.12, 4, 4);
    const craterMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.08, 0.2, 0.08 + Math.random() * 0.08),
      roughness: 0.9,
      flatShading: true,
    });
    const crater = new THREE.Mesh(craterGeo, craterMat);
    const phi = Math.random() * Math.PI * 2;
    const theta = Math.random() * Math.PI;
    const r = radius * 0.85;
    crater.position.set(
      Math.sin(theta) * Math.cos(phi) * r,
      Math.sin(theta) * Math.sin(phi) * r,
      Math.cos(theta) * r
    );
    crater.lookAt(new THREE.Vector3(0, 0, 0));
    crater.position.multiplyScalar(0.95);
    group.add(crater);
  }

  return group;
}

// 引力范围可视化环
export function createGravityRing(radius: number): THREE.Mesh {
  const geo = new THREE.TorusGeometry(radius, 0.3, 16, 48);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x4488ff,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = Math.PI / 2;
  return ring;
}

// 收集特效
export function createCollectEffect(position: THREE.Vector3, color: number): THREE.Points {
  const count = 25;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities: number[] = [];

  for (let i = 0; i < count; i++) {
    positions[i * 3] = position.x;
    positions[i * 3 + 1] = position.y;
    positions[i * 3 + 2] = position.z;
    velocities.push(
      (Math.random() - 0.5) * 0.2,
      (Math.random() - 0.5) * 0.2,
      (Math.random() - 0.5) * 0.2
    );
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.userData = { velocities };

  const mat = new THREE.PointsMaterial({
    color,
    size: 0.15,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 1,
  });

  const points = new THREE.Points(geo, mat);
  points.userData = { life: 0.6, velocities };
  return points;
}