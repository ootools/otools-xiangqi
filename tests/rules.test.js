import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialBoard, legalMoves, isLegalMove, makeMove, applyMove, pieceMoves,
  isCheck, isCheckmate, isStuckmate, gameStatus, toFEN, fromFEN,
  kingsFacing, moveToIccs, parseIccs,
} from '../web/js/engine/xiangqi.js';

const boardFromFen = (fen) => fromFEN(fen).board;

test('初始局面 FEN 与棋子数量', () => {
  const board = initialBoard();
  assert.equal(toFEN(board, 'w'), 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w');
  const flat = board.flat().filter(Boolean).join('');
  assert.equal(flat.length, 32);
  assert.equal([...flat].filter((p) => p === p.toUpperCase()).length, 16);
});

test('初始局面红方合法着法共 44 种', () => {
  assert.equal(legalMoves(initialBoard(), 'w').length, 44);
});

test('炮打隔子：隔一子可吃、且只吃架后第一子', () => {
  // 红炮 e1，红兵 e3 为炮架，黑卒 e6 为目标（黑将挪到 d9 避免干扰）
  const board = boardFromFen('3k5/9/9/4p4/9/9/4P4/9/4C4/4K4 w');
  const moves = pieceMoves(board, 1, 4);
  const captures = moves.filter((mv) => mv.captured);
  assert.equal(captures.length, 1);
  assert.deepEqual({ r: captures[0].to.r, c: captures[0].to.c }, { r: 6, c: 4 });

  // 架后第一子与更远一子同时存在：只吃架后第一子
  const board2 = boardFromFen('3k5/9/9/9/4p4/4p4/4P4/9/4C4/4K4 w');
  const captures2 = pieceMoves(board2, 1, 4).filter((mv) => mv.captured);
  assert.equal(captures2.length, 1);
  assert.deepEqual({ r: captures2[0].to.r, c: captures2[0].to.c }, { r: 4, c: 4 });
});

test('炮无炮架时不能吃子', () => {
  // 黑卒 e1 与红炮 e0 贴身（无架不吃）
  const board = boardFromFen('9/9/9/9/9/9/9/9/4p4/4C1K2 w');
  const moves = pieceMoves(board, 0, 4);
  assert.ok(!moves.some((mv) => mv.captured), '贴身无架不能吃');
});

test('蹩马腿', () => {
  // 黑士 e8 挡住 e 线避免照面
  const free = boardFromFen('4k4/4a4/9/9/9/9/9/6N2/9/4K4 w');
  const from = { r: 2, c: 6 }; // 红马 g2
  assert.ok(isLegalMove(free, 'w', from, { r: 4, c: 5 }), '马 g2 可跳 f4');
  assert.ok(isLegalMove(free, 'w', from, { r: 4, c: 7 }), '马 g2 可跳 h4');

  // g3 放红兵：蹩住 g2 上方长边腿（f4、h4 都经 g3）
  const blocked = boardFromFen('4k4/4a4/9/9/9/9/6P2/6N2/9/4K4 w');
  assert.ok(!isLegalMove(blocked, 'w', from, { r: 4, c: 5 }), 'g3 有子蹩腿，不能跳 f4');
  assert.ok(!isLegalMove(blocked, 'w', from, { r: 4, c: 7 }), 'g3 有子蹩腿，不能跳 h4');
  assert.ok(isLegalMove(blocked, 'w', from, { r: 3, c: 4 }), '横跳 e3 的腿在 f2，不受影响');
});

test('塞象眼', () => {
  const base = boardFromFen('3k5/9/9/9/9/9/9/9/9/2B1K4 w');
  const from = { r: 0, c: 2 }; // 红相 c0
  assert.ok(isLegalMove(base, 'w', from, { r: 2, c: 0 }), '象眼无子可飞 a2');
  assert.ok(isLegalMove(base, 'w', from, { r: 2, c: 4 }), '另一方向（e2）可飞');

  const blocked = boardFromFen('3k5/9/9/9/9/9/9/9/9/2B1K4 w');
  blocked[1][1] = 'P'; // b1 塞象眼
  assert.ok(!isLegalMove(blocked, 'w', from, { r: 2, c: 0 }), '象眼被塞不能飞 a2');
  assert.ok(isLegalMove(blocked, 'w', from, { r: 2, c: 4 }), '另一方向不受影响');
});

test('相/象不过河', () => {
  const board = boardFromFen('4k4/9/9/9/9/9/9/9/9/2B1K4 w');
  const moves = pieceMoves(board, 0, 2);
  assert.ok(moves.length > 0);
  for (const mv of moves) {
    assert.ok(mv.to.r <= 4, '红相不能过河');
  }
});

test('仕/士九宫约束', () => {
  // 红仕 e1（九宫中心，四个方向），黑士 e8 挡中路防照面
  const board = boardFromFen('4k4/4a4/9/9/9/9/9/9/4A4/4K4 w');
  const moves = pieceMoves(board, 1, 4);
  assert.equal(moves.length, 4, '九宫中心仕有四个方向');
  for (const mv of moves) {
    assert.ok(mv.to.r <= 2 && mv.to.c >= 3 && mv.to.c <= 5, '红仕只能在九宫');
  }
});

test('过河兵：过河前只进一格、过河后可进可平、永不可退', () => {
  const home = boardFromFen('4k4/9/9/9/9/9/6P2/9/9/4K4 w'); // 红兵 g3 未过河
  assert.deepEqual(
    pieceMoves(home, 3, 6).map((mv) => `${mv.to.r},${mv.to.c}`),
    ['4,6'],
    '未过河兵只能进一步',
  );

  const before = boardFromFen('4k4/9/9/9/9/6P2/9/9/9/4K4 w'); // 红兵 g4 仍未过河
  assert.deepEqual(
    pieceMoves(before, 4, 6).map((mv) => `${mv.to.r},${mv.to.c}`),
    ['5,6'],
  );

  const crossed = boardFromFen('4k4/9/9/9/6P2/9/9/9/9/4K4 w'); // 红兵 g5 已过河
  const dests = pieceMoves(crossed, 5, 6).map((mv) => `${mv.to.r},${mv.to.c}`).sort();
  assert.deepEqual(dests, ['5,5', '5,7', '6,6'], '过河兵可进可平');
});

test('双王照面：产生照面的着法不合法', () => {
  // 黑将 e9、红帅 e0、中间只有红车 e5；车平开即照面
  const board = boardFromFen('4k4/9/9/9/4R4/9/9/9/9/4K4 w');
  assert.equal(kingsFacing(board), false, '中间有车不照面');
  const rookFrom = { r: 5, c: 4 };
  assert.equal(isLegalMove(board, 'w', rookFrom, { r: 5, c: 3 }), false, '车 e5 平 d5 造成照面，非法');
  assert.equal(isLegalMove(board, 'w', rookFrom, { r: 5, c: 5 }), false, '车 e5 平 f5 造成照面，非法');
  assert.equal(isLegalMove(board, 'w', rookFrom, { r: 4, c: 4 }), true, '车仍在 e 线隔挡，合法');
  assert.equal(isLegalMove(board, 'w', rookFrom, { r: 5, c: 4 }), false, '原地不走不构成着法');
  // 直接构造照面局面
  assert.equal(kingsFacing(boardFromFen('4k4/9/9/9/9/9/9/9/9/4K4 w')), true);
});

test('送将禁手：所有合法着法走后均不被将军', () => {
  // 黑车 e1 贴脸将军红帅 e0（车无根，帅可吃车或走开）
  const board = boardFromFen('4k4/9/9/9/9/9/9/9/4r4/4K4 w');
  assert.equal(isCheck(board, 'w'), true, '红帅被黑车将军');
  const moves = legalMoves(board, 'w');
  assert.ok(moves.length > 0, '被将军方应有应将着法');
  for (const mv of moves) {
    const next = applyMove(board, mv);
    assert.equal(isCheck(next, 'w'), false, `非法送将着法混入: ${moveToIccs(mv.from, mv.to)}`);
  }
});

test('无合法应将且被将军 → 将死（重炮闷宫样本）', () => {
  // 黑将 e9，黑双士 d9/f9；红炮 e7 + e2（重炮借炮架将军），红仕 d0、红帅 e0
  const mate = boardFromFen('3aka3/9/4C4/9/9/9/9/4C4/9/3AK4 b');
  assert.equal(isCheck(mate, 'b'), true, '重炮将军');
  assert.equal(isCheckmate(mate, 'b'), true, '重炮杀为将死');
  // 黑士进中并不能解将（前炮借士做架继续将军），说明其不合法
  const afterBlock = applyMove(mate, {
    from: { r: 9, c: 3 }, to: { r: 8, c: 4 },
    piece: 'a', captured: null,
  });
  assert.equal(isCheck(afterBlock, 'b'), true, '士5进4后仍被将军（故为非法应将）');
});

test('困毙：未被将军但无合法着法，判负', () => {
  // 黑将 e9；红车 d8、f8 控制 d9/f9/e8，红马 g7 兜底
  const board = boardFromFen('4k4/3R1R3/6N2/9/9/9/9/9/9/4K4 b');
  assert.equal(isCheck(board, 'b'), false, '黑方未被将军');
  assert.equal(isStuckmate(board, 'b'), true, '黑方困毙');
  const st = gameStatus(board, 'b');
  assert.equal(st.over, true);
  assert.equal(st.winner, 'w');
  assert.equal(st.reason, 'stuckmate');
});

test('gameStatus：正常局面不终局', () => {
  const st = gameStatus(initialBoard(), 'w');
  assert.equal(st.over, false);
  assert.equal(st.inCheck, false);
  assert.equal(st.winner, null);
});

test('makeMove 拒绝非法着法并正确更新棋盘', () => {
  const board = initialBoard();
  const next = makeMove(board, 'w', { r: 2, c: 7 }, { r: 2, c: 4 }); // 炮二平五
  assert.equal(next[2][4], 'C');
  assert.equal(next[2][7], null);
  assert.throws(() => makeMove(board, 'w', { r: 0, c: 0 }, { r: 5, c: 5 }), /非法着法/);
  assert.throws(() => makeMove(board, 'w', { r: 3, c: 4 }, { r: 5, c: 4 }), /非法着法/, '兵不能一次走两格');
  assert.throws(() => makeMove(board, 'b', { r: 2, c: 7 }, { r: 2, c: 4 }), /非法着法/, '不是行棋方的子不能动');
});

test('ICCS 与坐标互换', () => {
  assert.equal(moveToIccs({ r: 2, c: 7 }, { r: 2, c: 4 }), 'H2-E2');
  assert.deepEqual(parseIccs('B0-C2').from, { r: 0, c: 1 });
  assert.deepEqual(parseIccs('B0-C2').to, { r: 2, c: 2 });
  assert.deepEqual(parseIccs('h9-g7').from, { r: 9, c: 7 });
  assert.deepEqual(parseIccs('h9-g7').to, { r: 7, c: 6 });
  assert.throws(() => parseIccs('Z9-Z9'), /无法解析/);
});
