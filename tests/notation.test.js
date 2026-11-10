import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialBoard, toChineseNotation, fromFEN, applyMove, makeMove, isLegalMove,
  parseIccs, moveOfIccs,
} from '../web/js/engine/xiangqi.js';

const boardFromFen = (fen) => fromFEN(fen).board;

test('初始局面常见着法记谱抽查', () => {
  const board = initialBoard();
  // 炮二平五 = H2-E2
  assert.equal(toChineseNotation(board, 'w', { r: 2, c: 7 }, { r: 2, c: 4 }), '炮二平五');
  // 马八进七 = B0-C2
  assert.equal(toChineseNotation(board, 'w', { r: 0, c: 1 }, { r: 2, c: 2 }), '马八进七');
  // 马二进三 = H0-G2
  assert.equal(toChineseNotation(board, 'w', { r: 0, c: 7 }, { r: 2, c: 6 }), '马二进三');
  // 车一进一 = I0-I1
  assert.equal(toChineseNotation(board, 'w', { r: 0, c: 8 }, { r: 1, c: 8 }), '车一进一');
  // 兵七进一 = C3-C4
  assert.equal(toChineseNotation(board, 'w', { r: 3, c: 2 }, { r: 4, c: 2 }), '兵七进一');
  // 黑方：马8进7 = h9-g7；炮8平5 = h7-e7
  assert.equal(toChineseNotation(board, 'b', { r: 9, c: 7 }, { r: 7, c: 6 }), '马8进7');
  assert.equal(toChineseNotation(board, 'b', { r: 7, c: 7 }, { r: 7, c: 4 }), '炮8平5');
});

test('黑方用阿拉伯数字且方向相反', () => {
  const board = initialBoard();
  // 黑士 6 进 5: f9 → e8
  assert.equal(toChineseNotation(board, 'b', { r: 9, c: 5 }, { r: 8, c: 4 }), '士6进5');
  // 黑车 9 平 8: i9 → h9（横移，无进退）
  assert.equal(toChineseNotation(board, 'b', { r: 9, c: 8 }, { r: 9, c: 7 }), '车9平8');
  // 黑象 7 进 5: g9 → e7
  assert.equal(toChineseNotation(board, 'b', { r: 9, c: 6 }, { r: 7, c: 4 }), '象7进5');
});

test('红方退着记谱', () => {
  // 黑士 e8 挡住 e 线避免照面；红马 e7 → d5
  const board = boardFromFen('4k4/4a4/4N4/9/9/9/9/9/9/4K4 w');
  assert.equal(toChineseNotation(board, 'w', { r: 7, c: 4 }, { r: 5, c: 3 }), '马五退六');
});

test('同列双子用 前/后 区分（弃马十三着 第 10 着）', () => {
  // 复现弃马十三着前 9 着后，红双车同在 d 列（d8/d1），前车进一 = D8-D9
  const moves = ['H2-E2', 'H7-E7', 'H0-G2', 'H9-G7', 'I0-I1', 'I9-H9', 'I1-D1',
    'H9-H3', 'D1-D8', 'B9-A7', 'A0-A1', 'B7-B0', 'B2-B7', 'G7-H9',
    'E2-E6', 'F9-E8', 'A1-D1', 'E9-F9'];
  let board = initialBoard();
  let side = 'w';
  for (const iccs of moves) {
    const { from, to } = parseIccs(iccs);
    board = makeMove(board, side, from, to);
    side = side === 'w' ? 'b' : 'w';
  }
  assert.equal(toChineseNotation(board, 'w', { r: 8, c: 3 }, { r: 9, c: 3 }), '前车进一');
  // 单车时记“车六平四”不带前缀
  const after = boardFromFen('4k4/9/9/9/9/9/9/9/3R5/3AK4 w');
  assert.equal(toChineseNotation(after, 'w', { r: 1, c: 3 }, { r: 1, c: 5 }), '车六平四');
});

test('同一纵线三兵用 前/中/后 简化', () => {
  // 红兵 e5、e6、e7（均过河可平移；红方 r 越大越深入敌阵、越靠前）
  const board = boardFromFen('4k4/9/4P4/4P4/4P4/9/9/9/9/4K4 w');
  assert.equal(toChineseNotation(board, 'w', { r: 7, c: 4 }, { r: 7, c: 3 }), '前兵平六');
  assert.equal(toChineseNotation(board, 'w', { r: 6, c: 4 }, { r: 6, c: 3 }), '中兵平六');
  assert.equal(toChineseNotation(board, 'w', { r: 5, c: 4 }, { r: 5, c: 3 }), '后兵平六');
});

test('不同纵线同名棋子无需前缀', () => {
  const board = boardFromFen('4k4/9/2N3N2/9/9/9/9/9/9/4K4 w');
  // 红方 r 增大为进：c7 → e8 为进，c7 → d5 为退
  assert.equal(toChineseNotation(board, 'w', { r: 7, c: 2 }, { r: 8, c: 4 }), '马七进五');
  assert.equal(toChineseNotation(board, 'w', { r: 7, c: 2 }, { r: 5, c: 3 }), '马七退六');
  assert.equal(toChineseNotation(board, 'w', { r: 7, c: 6 }, { r: 5, c: 5 }), '马三退四');
});

test('记谱方向与步数：红进为行数增大、黑进为行数减小', () => {
  // 红炮 e2 → e6 吃黑卒（红兵 e3 为炮架）：炮五进四
  const board = boardFromFen('4k4/9/9/9/9/4p4/4P4/4C4/9/4K4 w');
  assert.equal(toChineseNotation(board, 'w', { r: 2, c: 4 }, { r: 6, c: 4 }), '炮五进四');
  // 黑炮 e7 → e6：炮5进1
  const board2 = boardFromFen('4k4/9/4c4/9/9/9/9/9/9/4K4 b');
  assert.equal(toChineseNotation(board2, 'b', { r: 7, c: 4 }, { r: 6, c: 4 }), '炮5进1');
});

test('applyMove 与记谱联动：弃马十三着全部着法', () => {
  // 完整 13 着（详见 tests/games.test.js 的逐步校验），此处抽查两处典型记谱
  const moves = [
    ['H2-E2', '炮二平五'], ['H7-E7', '炮8平5'],
    ['H0-G2', '马二进三'], ['H9-G7', '马8进7'],
    ['I0-I1', '车一进一'], ['I9-H9', '车9平8'],
    ['I1-D1', '车一平六'], ['H9-H3', '车8进6'],
    ['D1-D8', '车六进七'], ['B9-A7', '马2进1'],
    ['A0-A1', '车九进一'], ['B7-B0', '炮2进7'],
  ];
  let board = initialBoard();
  let side = 'w';
  for (const [iccs, expect] of moves) {
    const { from, to } = parseIccs(iccs);
    assert.equal(toChineseNotation(board, side, from, to), expect, iccs);
    board = applyMove(board, { from, to, piece: board[from.r][from.c], captured: board[to.r][to.c] || null });
    side = side === 'w' ? 'b' : 'w';
  }
  // 第 7 着 炮八进五 = B2-B7
  assert.equal(toChineseNotation(board, 'w', { r: 2, c: 1 }, { r: 7, c: 1 }), '炮八进五');
});

test('moveOfIccs 辅助', () => {
  const mv = moveOfIccs('H2-E2');
  assert.deepEqual(mv.from, { r: 2, c: 7 });
  assert.deepEqual(mv.to, { r: 2, c: 4 });
});
