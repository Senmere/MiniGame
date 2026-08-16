// 动态星空背景

import * as THREE from 'three';

export function createStarfield(): THREE.Points {
  const count = 2000;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // 球形分布
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const radius = 30 + Math.random() * 70;

    positions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
    positions[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * radius;
    positions[i * 3 + 2] = Math.cos(phi) * radius;

    // 蓝白到金黄的星星颜色
    const colorChoice = Math.random();
    if (colorChoice < 0.7) {
      colors[i * 3] = 0.7 + Math.random() * 0.3;
      colors[i * 3 + 1] = 0.7 + Math.random() * 0.3;
      colors[i * 3 + 2] = 0.8 + Math.random() * 0.2;
    } else if (colorChoice < 0.9) {
      colors[i * 3] = 0.5 + Math.random() * 0.3;
      colors[i * 3 + 1] = 0.6 + Math.random() * 0.3;
      colors[i * 3 + 2] = 0.9 + Math.random() * 0.1;
    } else {
      colors[i * 3] = 0.9 + Math.random() * 0.1;
      colors[i * 3 + 1] = 0.7 + Math.random() * 0.2;
      colors[i * 3 + 2] = 0.3 + Math.random() * 0.3;
    }

    sizes[i] = Math.random() * 2.5 + 0.5;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.PointsMaterial({
    size: 0.15,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.8,
    sizeAttenuation: true,
  });

  const stars = new THREE.Points(geo, mat);
  stars.userData = { twinkleOffsets: new Float32Array(count).map(() => Math.random() * Math.PI * 2) };

  return stars;
}

// 更新星星闪烁
export function updateStarfield(stars: THREE.Points, time: number): void {
  const mat = stars.material as THREE.PointsMaterial;
  // 缓慢旋转
  stars.rotation.y += 0.0001;
  stars.rotation.x += 0.00005;

  // 整体闪烁
  mat.opacity = 0.7 + Math.sin(time * 0.5) * 0.1;
}