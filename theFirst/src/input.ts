// 输入处理 - 飞船旋转 + 空格加速

export interface InputState {
  pitch: number;    // 俯仰 (-1~1), W/S
  yaw: number;      // 偏航 (-1~1), A/D
  roll: number;     // 滚转 (-1~1), Q/E
  boost: boolean;   // 空格加速
  mouseX: number;   // 鼠标X (-1~1)
  mouseY: number;   // 鼠标Y (-1~1)
}

export function createInputHandler(canvas: HTMLCanvasElement): {
  getState: () => InputState;
  dispose: () => void;
} {
  const keys = new Set<string>();
  const mouseState = { x: 0, y: 0 };

  function onKeyDown(e: KeyboardEvent) {
    keys.add(e.key.toLowerCase());
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key)) {
      e.preventDefault();
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    keys.delete(e.key.toLowerCase());
  }

  function onMouseMove(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    mouseState.x = (e.clientX - cx) / (rect.width / 2);
    mouseState.y = -(e.clientY - cy) / (rect.height / 2);
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('mousemove', onMouseMove);

  function getState(): InputState {
    let pitch = 0, yaw = 0, roll = 0;

    if (keys.has('w') || keys.has('arrowup')) pitch -= 1;
    if (keys.has('s') || keys.has('arrowdown')) pitch += 1;
    if (keys.has('a') || keys.has('arrowleft')) yaw -= 1;
    if (keys.has('d') || keys.has('arrowright')) yaw += 1;
    if (keys.has('q')) roll -= 1;
    if (keys.has('e')) roll += 1;

    const boost = keys.has(' ');

    return {
      pitch,
      yaw,
      roll,
      boost,
      mouseX: mouseState.x,
      mouseY: mouseState.y,
    };
  }

  return {
    getState,
    dispose: () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('mousemove', onMouseMove);
    },
  };
}