// 象棋引擎规则测试脚本（对编译产物 dist 运行）
// 用法: node test-engine.mjs
import { xiangqiEngine as g } from './dist/games/xiangqi/engine.js';

let pass = 0, fail = 0;
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
};

console.log('== 1. 初始局面 ==');
const init = g.createInitial(2);
const initLegals = g.legalActions(init, 0);
console.log(`  红方初始合法着法数: ${initLegals.length} (标准中国象棋为 44)`);
ok(initLegals.length === 44, `初始红方合法着法 = 44 (实际 ${initLegals.length})`);
ok(g.legalActions(init, 1).length === 0, '初始黑方不能先行 (turn=r)');
ok(g.currentPlayer(init) === 0, 'currentPlayer = 0 (红方)');
ok(init.halfMoves === 0, 'halfMoves 初始 0');

console.log('\n== 2. 兵/卒走法 ==');
ok(g.isLegal(init, 0, [6, 4, 5, 4]), '红兵(6,4)→(5,4) 合法 (前进)');
ok(!g.isLegal(init, 0, [6, 4, 6, 3]), '红兵(6,4)→(6,3) 非法 (未过河不能横走)');
ok(!g.isLegal(init, 0, [6, 4, 7, 4]), '红兵(6,4)→(7,4) 非法 (兵不能后退)');
// 过河兵可横走: 红兵过河判定 r<=4（河界在 row4/row5 之间）。兵在 (5,4) 未过河 → 不能横走; 到 (4,4) 后才可横
let s2 = g.createInitial(2);
s2.board[5][4] = 'P'; s2.board[6][4] = '.';
ok(!g.isLegal(s2, 0, [5, 4, 5, 3]), '红兵(5,4) 未过河 → (5,3) 非法');
let s2b = g.createInitial(2);
s2b.board[4][4] = 'P'; s2b.board[6][4] = '.';
ok(g.isLegal(s2b, 0, [4, 4, 4, 3]), '过河红兵(4,4)→(4,3) 合法 (可横走)');
ok(g.isLegal(s2b, 0, [4, 4, 3, 4]), '过河红兵(4,4)→(3,4) 合法 (仍可前进)');
ok(!g.isLegal(s2b, 0, [4, 4, 5, 4]), '红兵(4,4)→(5,4) 非法 (不能后退)');
// 黑卒过河判定 r>=5: 黑卒在 (5,4) 已过河 → 可横走; 在 (4,4) 未过河 → 不可横走
let s2c = g.createInitial(2);
s2c.board[5][4] = 'p'; s2c.board[3][4] = '.';
ok(g.isLegal({ ...s2c, turn: 'b' }, 1, [5, 4, 5, 3]), '过河黑卒(5,4)→(5,3) 合法 (可横走)');
s2c.board[5][4] = '.'; s2c.board[4][4] = 'p';
ok(!g.isLegal({ ...s2c, turn: 'b' }, 1, [4, 4, 4, 3]), '黑卒(4,4) 未过河 → (4,3) 非法');
ok(g.isLegal({ ...s2c, turn: 'b' }, 1, [4, 4, 5, 4]), '黑卒(4,4)→(5,4) 合法 (前进)');
ok(!g.isLegal({ ...s2c, turn: 'b' }, 1, [4, 4, 3, 4]), '黑卒(4,4)→(3,4) 非法 (不能后退)');

console.log('\n== 3. 炮走法 ==');
// 红炮 (7,1)：列 1 上 (6,1)(5,1)(4,1)(3,1) 空 → 平走目标; (2,1) 黑炮是第一障碍(炮架) 不能吃也不能落;
// 越过炮架 (1,1) 空 → (0,1) 黑马 可吃
ok(g.isLegal(init, 0, [7, 1, 6, 1]), '红炮(7,1)→(6,1) 合法 (空位移动)');
ok(g.isLegal(init, 0, [7, 1, 3, 1]), '红炮(7,1)→(3,1) 合法 (空位移动, 炮架前)');
ok(!g.isLegal(init, 0, [7, 1, 2, 1]), '红炮(7,1)→(2,1) 非法 (黑炮是炮架, 不能吃不能落)');
ok(g.isLegal(init, 0, [7, 1, 0, 1]), '红炮(7,1)→(0,1) 合法 (翻黑炮吃黑马)');
ok(!g.isLegal(init, 0, [7, 1, 0, 4]), '红炮(7,1)→(0,4) 非法 (无炮架不可吃将)');
ok(!g.isLegal(init, 0, [7, 1, 9, 1]), '红炮(7,1)→(9,1) 非法 (炮不能斜走)');

console.log('\n== 4. 马走法 ==');
// 红马 (9,1) 初始: (8,3)? leg=(9,2) 有红相 → 蹩腿; (7,2): leg=(8,1) 空 → 合法
ok(g.isLegal(init, 0, [9, 1, 7, 2]), '红马(9,1)→(7,2) 合法');
ok(!g.isLegal(init, 0, [9, 1, 8, 3]), '红马(9,1)→(8,3) 非法 (蹩马腿(9,2)有红相)');
// 清掉 (9,2) 后 (8,3) 应合法
let s4 = g.createInitial(2);
s4.board[9][2] = '.';
ok(g.isLegal(s4, 0, [9, 1, 8, 3]), '清障后红马(9,1)→(8,3) 合法');
// 黑马 (0,1) 蹩腿: (1,1) 放子 → 下走 (2,0)/(2,2) 的腿都在 (1,1)，全被蹩
let s4b = g.createInitial(2);
s4b.board[1][1] = 'P';
ok(!g.isLegal({ ...s4b, turn: 'b' }, 1, [0, 1, 2, 2]), '黑马(0,1)→(2,2) 非法 (蹩马腿(1,1)有子)');
ok(!g.isLegal({ ...s4b, turn: 'b' }, 1, [0, 1, 2, 0]), '黑马(0,1)→(2,0) 非法 (腿(1,1)有子)');
// 清掉 (1,1) 后 (2,0) 合法
let s4c = g.createInitial(2);
s4c.board[1][1] = '.';
ok(g.isLegal({ ...s4c, turn: 'b' }, 1, [0, 1, 2, 0]), '清障后黑马(0,1)→(2,0) 合法');
// 黑马 (0,1) → (1,3): 腿在 (0,2)，有黑相 → 蹩腿
ok(!g.isLegal({ ...s4c, turn: 'b' }, 1, [0, 1, 1, 3]), '黑马(0,1)→(1,3) 非法 (腿(0,2)有黑相)');

console.log('\n== 5. 车/相/仕/帅 ==');
// 红车 (9,0): 行方向被自己马相仕挡住; 列方向 (8,0)(7,0) 空, (6,0) 红兵挡
ok(g.isLegal(init, 0, [9, 0, 8, 0]), '红车(9,0)→(8,0) 合法');
ok(g.isLegal(init, 0, [9, 0, 7, 0]), '红车(9,0)→(7,0) 合法');
ok(!g.isLegal(init, 0, [9, 0, 9, 4]), '红车(9,0)→(9,4) 非法 (隔自己马)');
ok(!g.isLegal(init, 0, [9, 0, 6, 0]), '红车(9,0)→(6,0) 非法 (隔自己兵)');
// 仕: 一步斜行于九宫内
ok(g.isLegal(init, 0, [9, 3, 8, 4]), '红仕(9,3)→(8,4) 合法 (宫内一步斜)');
ok(!g.isLegal(init, 0, [9, 3, 7, 5]), '红仕(9,3)→(7,5) 非法 (仕一步只走一格)');
ok(!g.isLegal(init, 0, [9, 3, 8, 3]), '红仕(9,3)→(8,3) 非法 (仕不走直线)');
// 相: 田字, 象眼
ok(g.isLegal(init, 0, [9, 2, 7, 4]), '红相(9,2)→(7,4) 合法 (象眼(8,3)空)');
let s5 = g.createInitial(2);
s5.board[8][1] = 'P';
ok(!g.isLegal(s5, 0, [9, 2, 7, 0]), '红相(9,2)→(7,0) 非法 (象眼(8,1)有兵)');
let s5b = g.createInitial(2);
s5b.board[7][4] = 'B'; s5b.board[9][2] = '.';
ok(g.isLegal(s5b, 0, [7, 4, 5, 6]), '红相(7,4)→(5,6) 合法 (未过河)');
s5b.board[6][3] = 'P'; // 象眼放子
ok(!g.isLegal(s5b, 0, [7, 4, 5, 2]), '红相(7,4)→(5,2) 非法 (象眼(6,3)有兵)');
// 相不过河: (5,6) tr=5 未过河合法; 到 (3,6) tr=3 过河非法
let s5c = g.createInitial(2);
s5c.board[7][4] = 'B'; s5c.board[9][2] = '.';
s5c.board[5][6] = '.';
ok(!g.isLegal(s5c, 0, [7, 4, 3, 6]), '红相(7,4)→(3,6) 非法 (过河)');
// 帅: 宫内一步
ok(g.isLegal(init, 0, [9, 4, 8, 4]), '红帅(9,4)→(8,4) 合法 (宫内直行)');
ok(!g.isLegal(init, 0, [9, 4, 8, 3]), '红帅(9,4)→(8,3) 非法 (帅不能斜走)');
ok(!g.isLegal(init, 0, [9, 4, 7, 4]), '红帅(9,4)→(7,4) 非法 (帅一步一格)');

console.log('\n== 6. 将军与应将 ==');
// 红车 (5,4) 将军黑将 (0,4)，中间 (1..4,4) 清空
let st5 = g.createInitial(2);
st5.board[5][4] = 'R';
st5.board[1][4] = '.'; st5.board[2][4] = '.'; st5.board[3][4] = '.'; st5.board[4][4] = '.';
ok(g.isGameOver(st5) === null, '被将军未结束 (需走棋)');
// 黑将 (0,4) 不能原地留 (0,4) 不变; (0,3) 有黑士占位 → 先清
let st5b = g.createInitial(2);
st5b.board[5][4] = 'R';
st5b.board[1][4] = '.'; st5b.board[2][4] = '.'; st5b.board[3][4] = '.'; st5b.board[4][4] = '.';
st5b.board[0][3] = '.';
ok(g.isLegal({ ...st5b, turn: 'b' }, 1, [0, 4, 0, 3]), '被将军时黑将(0,4)→(0,3) 合法 (避将)');
ok(!g.isLegal({ ...st5, turn: 'b' }, 1, [0, 4, 1, 4]), '黑将(0,4)→(1,4) 非法 (仍在车口)');
// 送将: 黑士 (0,3)→(1,4) 吃红车后，士恰好挡在 (1,4)，隔断 (5,4) 车与黑将 → 合法
let st5c = g.createInitial(2);
st5c.board[5][4] = 'R';
st5c.board[1][4] = '.'; st5c.board[2][4] = '.'; st5c.board[3][4] = '.'; st5c.board[4][4] = '.';
ok(g.isLegal({ ...st5c, turn: 'b' }, 1, [0, 3, 1, 4]), '黑士(0,3)→(1,4) 合法 (吃车后挡住车线)');
ok(g.isLegal({ ...st5c, turn: 'b' }, 1, [0, 5, 1, 4]), '黑士(0,5)→(1,4) 合法 (同样挡住车线)');
// 真送将: 黑士 (0,3)→(1,2) 不挡车线、不解决将军 → 非法
ok(!g.isLegal({ ...st5c, turn: 'b' }, 1, [0, 3, 1, 2]), '黑士(0,3)→(1,2) 非法 (送将: 未解决将军)');

console.log('\n== 7. 飞将检测 ==');
let st6 = g.createInitial(2);
st6.board[5][4] = 'k';
st6.board[6][4] = '.'; st6.board[7][4] = '.'; st6.board[8][4] = '.';
ok(!g.isLegal(st6, 0, [9, 4, 8, 4]), '红帅(9,4)→(8,4) 非法 (飞将: 两将同列无遮挡)');
// 黑将 (0,4) 与红帅 (9,4) 同列, 中间放子 → 帅可动; 帅 (9,4)→(8,4) 合法
let st6b = g.createInitial(2);
st6b.board[8][4] = 'R'; // 帅下方垫子 → 无飞将
ok(g.isLegal(st6b, 0, [9, 4, 8, 4]) === false, '红帅(9,4)→(8,4) 非法 (自有车占据)');
st6b.board[8][4] = '.';
ok(g.isLegal(st6b, 0, [9, 4, 8, 4]), '红帅(9,4)→(8,4) 合法 (宫内直行, 无飞将)');
ok(!g.isLegal(st6b, 0, [9, 4, 8, 5]), '红帅(9,4)→(8,5) 非法 (帅不能斜走)');
// 黑将 (9,4)? 黑方: 黑将不能下到红方九宫, 构造黑将 (0,4) 帅 (9,4) 飞将: 帅直接照面时, 帅 (9,4)→(8,4) 非法已测
// 再测: 红方送将(帅被将攻击): 黑车 (9,3) 攻击 (9,4)? 帅 (9,4)→(8,4) 后黑车 (9,3) 仍攻不到 (8,4); 改测黑炮
let st6c = g.createInitial(2);
st6c.board[8][0] = 'c'; // 黑炮在 (8,0)
st6c.board[5][0] = 'P'; // 炮架
// 黑炮 (8,0) 翻 (5,0) 兵吃 (2,0) 空 → 不威胁帅; 帅 (9,4) 不动。此例仅验证不误伤
ok(g.isGameOver(st6c) === null, '炮在远处不误判终局');

console.log('\n== 8. applyAction / encode / describe ==');
let s = g.createInitial(2);
const moved = g.applyAction(s, 0, [7, 1, 7, 4]);
ok(moved !== s, 'applyAction 不可变 (返回新对象)');
ok(moved.board[7][4] === 'C' && moved.board[7][1] === '.', '炮从(7,1)走到(7,4)');
ok(moved.turn === 'b', '走完后轮到黑方');
ok(moved.halfMoves === 1, 'halfMoves +1');
const enc = g.encode(moved);
ok(enc.compact.startsWith('b|'), 'compact 编码以当前回合开头');
ok(enc.readable.includes('轮到'), 'readable 含轮到信息');
const desc = g.describeAction(moved, [7, 4, 2, 4]);
console.log(`  describeAction 示例: ${desc}`);
ok(desc.includes('炮'), 'describeAction 中文描述');

console.log('\n== 9. 吃将终局 ==');
let st7 = g.createInitial(2);
st7.board[1][4] = 'R';
st7.board[0][4] = 'k';
st7.board[0][3] = '.';
const after = g.applyAction(st7, 0, [1, 4, 0, 4]);
ok(after.board[0][4] === 'R' && after.board[1][4] === '.', '车吃将后棋盘更新');
const over = g.isGameOver(after);
ok(over !== null && over.winner === 0, `吃将终局 winner=0 (实际: ${JSON.stringify(over)})`);

console.log('\n== 10. 困毙(无路可走) ==');
// 黑将 (0,4); 红车 (1,4) + 红帅 (9,4) 且 (2..8,4) 全空 → 将不能吃 (1,4) 会飞将
// 红车 (0,3),(0,5) 夹住两侧 → 吃任一侧都会被另一侧车攻击
let st9 = g.createInitial(2);
st9.turn = 'b'; // 轮到黑方
for (let c = 0; c < 9; c++) { st9.board[0][c] = '.'; st9.board[1][c] = '.'; }
for (let r = 2; r <= 8; r++) st9.board[r][4] = '.';
st9.board[0][4] = 'k';
st9.board[0][3] = 'R'; st9.board[0][5] = 'R';
st9.board[9][4] = 'K';
st9.board[1][4] = 'R';
const legals9 = g.legalActions(st9, 1);
console.log(`  困毙局面黑方合法着法数: ${legals9.length}`);
ok(legals9.length === 0, '困毙局面黑方无合法着法');
const over9 = g.isGameOver(st9);
ok(over9 !== null && over9.winner === 0, `困毙判红方胜 (实际: ${JSON.stringify(over9)})`);

console.log('\n== 11. 半回合上限平局 ==');
let st10 = g.createInitial(2);
st10.halfMoves = 301;
const over10 = g.isGameOver(st10);
ok(over10 !== null && over10.winner === null, `301 半回合 → 平局 (实际: ${JSON.stringify(over10)})`);

console.log('\n== 12. 随机对局冒烟 (500 步不死循环) ==');
let st11 = g.createInitial(2);
let steps = 0, movesMade = 0;
while (steps < 500) {
  const seat = g.currentPlayer(st11);
  const legals = g.legalActions(st11, seat);
  if (legals.length === 0) break;
  const a = legals[Math.floor(Math.random() * legals.length)];
  st11 = g.applyAction(st11, seat, a);
  movesMade++;
  const over11 = g.isGameOver(st11);
  if (over11) break;
  steps++;
}
console.log(`  随机对局: ${movesMade} 步后结束`);
ok(movesMade > 20, `随机对局至少 20 步 (实际 ${movesMade})`);

console.log('\n== 13. 三次重复局面判和 ==');
// 构造：红车 (5,0)↔(5,1) 来回、黑车 (4,0)↔(4,1) 来回，4 步一个完整循环回到原局面
// 注意：手动清空棋盘后，"干净局面"首次出现于第 1 个循环结束（step4），故需 3 个循环（12 步）才累计 3 次
let s13 = g.createInitial(2);
// 清空中间地带避免干扰
for (let r = 1; r <= 8; r++) for (let c = 0; c < 9; c++) s13.board[r][c] = '.';
s13.board[0][4] = 'k'; s13.board[9][4] = 'K';
s13.board[5][0] = 'R'; s13.board[4][0] = 'r'; // 红车+黑车
// 走 3 个完整循环（12 步）→ 干净局面出现 3 次（step4/8/12）
const moves13 = [
  [5, 0, 5, 1], [4, 0, 4, 1],
  [5, 1, 5, 0], [4, 1, 4, 0],
  [5, 0, 5, 1], [4, 0, 4, 1],
  [5, 1, 5, 0], [4, 1, 4, 0],
  [5, 0, 5, 1], [4, 0, 4, 1],
  [5, 1, 5, 0], [4, 1, 4, 0],
];
let st13 = s13;
for (const mv of moves13) {
  st13 = g.applyAction(st13, st13.turn === 'r' ? 0 : 1, mv);
}
// 走完 12 步后 turn=r，红车回到 (5,0)、黑车回到 (4,0) → 干净局面已出现 3 次
const over13 = g.isGameOver(st13);
console.log(`  重复局面后 isGameOver: ${JSON.stringify(over13)}`);
ok(over13 !== null && over13.winner === null, `三次重复局面 → 判和 (实际: ${JSON.stringify(over13)})`);
ok((over13?.reason ?? '').includes('重复'), `和棋原因为"重复" (实际: ${over13?.reason})`);
// 半程验证：2 个循环（8 步）后不应判和（干净局面只出现 2 次）
let st13b = s13;
for (const mv of moves13.slice(0, 8)) {
  st13b = g.applyAction(st13b, st13b.turn === 'r' ? 0 : 1, mv);
}
ok(g.isGameOver(st13b) === null, '2 个循环后未判和（次数不足 3）');

console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========`);
process.exit(fail > 0 ? 1 : 0);
