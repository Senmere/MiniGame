export interface XiangqiState {
  board: string[][];
  turn: 'r' | 'b';
  seats: number;
  halfMoves: number;
}

const PIECE_NAME: Record<string, string> = {
  K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵',
  k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒',
};

// 炮位与兵位（传统棋盘上的十字角标记位置）
const MARK_POINTS: [number, number][] = [
  [1, 2], [7, 2], [1, 7], [7, 7], // 炮位
  [0, 3], [2, 3], [4, 3], [6, 3], [8, 3], // 黑卒位
  [0, 6], [2, 6], [4, 6], [6, 6], [8, 6], // 红兵位
];

function bracket(c: number, r: number, dx: number, dy: number): string {
  // 在 (c,r) 的某个象限画一个 L 形角标
  const x0 = c + 0.22 * dx;
  const y0 = r + 0.14 * dy;
  const x1 = c + 0.14 * dx;
  const y1 = r + 0.14 * dy;
  const x2 = c + 0.14 * dx;
  const y2 = r + 0.06 * dy;
  return `M ${x0} ${y0} L ${x1} ${y1} L ${x2} ${y2}`;
}

export default function XiangqiBoard({
  state,
  lastFrom,
  lastTo,
}: {
  state: XiangqiState | null;
  lastFrom?: [number, number] | null;
  lastTo?: [number, number] | null;
}) {
  if (!state) {
    return <div className="card muted">等待对局开始…</div>;
  }

  const lines: React.ReactNode[] = [];
  // 横线 10 条
  for (let r = 0; r <= 9; r++) {
    lines.push(<line key={`h${r}`} x1={0} y1={r} x2={8} y2={r} stroke="#5a3a1a" strokeWidth={0.04} />);
  }
  // 竖线 9 条：外侧通栏，内侧在河界断开
  for (let c = 0; c <= 8; c++) {
    if (c === 0 || c === 8) {
      lines.push(<line key={`v${c}`} x1={c} y1={0} x2={c} y2={9} stroke="#5a3a1a" strokeWidth={0.04} />);
    } else {
      lines.push(<line key={`va${c}`} x1={c} y1={0} x2={c} y2={4} stroke="#5a3a1a" strokeWidth={0.04} />);
      lines.push(<line key={`vb${c}`} x1={c} y1={5} x2={c} y2={9} stroke="#5a3a1a" strokeWidth={0.04} />);
    }
  }
  // 九宫斜线
  lines.push(<line key="ptl" x1={3} y1={0} x2={5} y2={2} stroke="#5a3a1a" strokeWidth={0.04} />);
  lines.push(<line key="ptr" x1={5} y1={0} x2={3} y2={2} stroke="#5a3a1a" strokeWidth={0.04} />);
  lines.push(<line key="pbl" x1={3} y1={7} x2={5} y2={9} stroke="#5a3a1a" strokeWidth={0.04} />);
  lines.push(<line key="pbr" x1={5} y1={7} x2={3} y2={9} stroke="#5a3a1a" strokeWidth={0.04} />);

  // 炮/兵位角标
  const marks: string[] = [];
  for (const [c, r] of MARK_POINTS) {
    const corners: string[] = [];
    if (c > 0) corners.push(bracket(c, r, -1, -1), bracket(c, r, -1, 1));
    if (c < 8) corners.push(bracket(c, r, 1, -1), bracket(c, r, 1, 1));
    marks.push(...corners);
  }
  if (marks.length) {
    lines.push(<path key="marks" d={marks.join(' ')} stroke="#5a3a1a" strokeWidth={0.04} fill="none" />);
  }

  // 河界文字
  const river = (
    <>
      <text x={2} y={4.62} fontSize={0.7} letterSpacing={0.3} fill="#7a5a2a" textAnchor="middle">楚 河</text>
      <text x={6} y={4.62} fontSize={0.7} letterSpacing={0.3} fill="#7a5a2a" textAnchor="middle">漢 界</text>
    </>
  );

  // 坐标标签
  const coords: React.ReactNode[] = [];
  for (let r = 0; r <= 9; r++) coords.push(<text key={`cr${r}`} x={-0.55} y={r + 0.08} fontSize={0.32} fill="#9a8a6a" textAnchor="middle">{r}</text>);
  for (let c = 0; c <= 8; c++) coords.push(<text key={`cc${c}`} x={c} y={-0.4} fontSize={0.32} fill="#9a8a6a" textAnchor="middle">{c}</text>);

  // 上一步起止高亮
  const highlight =
    (lastFrom || lastTo) && (
      <>
        {lastFrom && <circle cx={lastFrom[1]} cy={lastFrom[0]} r={0.5} fill="none" stroke="#4f8cff" strokeWidth={0.07} strokeDasharray="0.12 0.1" />}
        {lastTo && <circle cx={lastTo[1]} cy={lastTo[0]} r={0.5} fill="none" stroke="#4f8cff" strokeWidth={0.07} strokeDasharray="0.12 0.1" />}
      </>
    );

  // 棋子（落在交叉点上）
  const pieces: React.ReactNode[] = [];
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = state.board[r][c];
      if (p === '.') continue;
      const isRed = p === p.toUpperCase();
      const color = isRed ? '#c0392b' : '#1a1a1a';
      pieces.push(
        <g key={`p${r}-${c}`}>
          <circle cx={c} cy={r} r={0.46} fill="#f5ecd6" stroke={color} strokeWidth={0.06} />
          <text x={c} y={r + 0.16} fontSize={0.62} fontWeight={700} fill={color} textAnchor="middle">{PIECE_NAME[p]}</text>
        </g>,
      );
    }
  }

  return (
    <svg viewBox="-1 -1 10 11" style={{ width: '100%', maxWidth: 520, aspectRatio: '10 / 11', display: 'block', margin: '12px auto' }}>
      <rect x={-1} y={-1} width={10} height={11} fill="url(#wood)" />
      <defs>
        <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e6c485" />
          <stop offset="50%" stopColor="#d9b27c" />
          <stop offset="100%" stopColor="#e6c485" />
        </linearGradient>
      </defs>
      {lines}
      {river}
      {coords}
      {highlight}
      {pieces}
    </svg>
  );
}
