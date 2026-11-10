import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toFEN, fromFEN, validateSetup, positionKey, initialBoard } from '../web/js/engine/xiangqi.js';

test('FEN 往返一致：初始局面', () => {
  const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';
  const { board, side } = fromFEN(fen);
  assert.equal(side, 'w');
  assert.equal(toFEN(board, side), fen);
  assert.deepEqual(fromFEN(fen).board, initialBoard());

  const { board: board2, side: side2 } = fromFEN(toFEN(board, 'b'));
  assert.equal(side2, 'b');
  assert.deepEqual(board2, board);
});

test('FEN 往返一致：真实中局（弃马十三着第 8 着后）', () => {
  const fen = '2bak1bn1/4a4/1C7/p1p1C1p1p/9/9/P1P1P1P1P/6N2/R8/2BAKAB2 w';
  const { board, side } = fromFEN(fen);
  assert.equal(side, 'w');
  assert.equal(toFEN(board, side), fen);
});

test('FEN 解析非法输入报错', () => {
  assert.throws(() => fromFEN('rnbakabnr w'), /无法解析|FEN/);
  assert.throws(() => fromFEN('rnbakabnr/9/1c5c1/9/9/9/P1P1P1P1P/1C5C1/RNBAKABNR w'), /FEN/); // 只有 9 行
  assert.throws(() => fromFEN('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR x'), /行棋方/);
  assert.throws(() => fromFEN('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKZBNR w'), /非法字符/);
  assert.throws(() => fromFEN('rnbakabnr/10/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w'), /FEN/);
});

test('positionKey 区分行棋方', () => {
  const board = initialBoard();
  assert.notEqual(positionKey(board, 'w'), positionKey(board, 'b'));
  assert.equal(positionKey(board, 'w'), toFEN(board, 'w'));
});

test('validateSetup：合法残局摆盘通过', () => {
  const result = validateSetup(fromFEN('4k4/9/9/9/9/9/9/9/4R4/4K4 w').board);
  assert.equal(result.ok, true, result.errors.join(';'));
});

test('validateSetup：缺王报错', () => {
  const result = validateSetup(fromFEN('9/9/9/9/9/9/9/9/9/4K4 w').board);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('缺少')));
});

test('validateSetup：王不在九宫报错', () => {
  const result = validateSetup(fromFEN('k7K/9/9/9/9/9/9/9/9/9 w').board);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('九宫')));
});

test('validateSetup：双王照面报错', () => {
  const result = validateSetup(fromFEN('4k4/9/9/9/9/9/9/9/9/4K4 w').board);
  assert.equal(result.ok, false, 'e 线中间无子的双王照面应报错');
  assert.ok(result.errors.some((e) => e.includes('照面')));
});

test('validateSetup：红兵落后场报错', () => {
  const board = fromFEN('4k4/9/9/9/9/9/9/9/9/4K4 w').board;
  board[1][4] = 'P'; // 红兵放到 e1（未开进过的后场）
  const result = validateSetup(board);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('红兵')));
});

test('validateSetup：棋子超量报错', () => {
  const board = fromFEN('4k4/9/9/9/9/9/9/9/9/4K4 w').board;
  board[5][0] = 'R'; board[5][1] = 'R'; board[5][2] = 'R'; // 红方第三个车
  const result = validateSetup(board);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('车') && e.includes('超出')));
});
