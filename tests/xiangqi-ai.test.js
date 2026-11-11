import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialBoard, fromFEN, applyMove, makeMove, gameStatus, legalMoves,
  moveToIccs, replayMoves,
} from '../web/js/engine/xiangqi.js';
import { chooseMove, AI_LEVELS } from '../web/js/engine/xiangqi-ai.js';
import { GAMES } from '../web/data/games/index.js';

const LEVELS = ['easy', 'normal', 'hard'];
const iccs = (mv) => moveToIccs(mv.from, mv.to);

/** 重炮演示局终局前局面（红方一步 H2-E2 成重炮将死）。 */
function mateInOneBoard() {
  const game = GAMES.find((g) => g.id === 'demo-chongppao');
  assert.ok(game, '缺少 demo-chongppao 演示局');
  const rep = replayMoves(fromFEN(game.fen).board, 'w', game.moves.slice(0, -1).map((m) => m.iccs));
  assert.equal(rep.error, null, `演示局重放失败: ${rep.error}`);
  return { board: rep.finalBoard, side: rep.finalSide };
}

test('AI_LEVELS 定义三档难度（深度/时间预算）', () => {
  assert.deepEqual(AI_LEVELS.easy, { timeMs: 200, maxDepth: 2 });
  assert.deepEqual(AI_LEVELS.normal, { timeMs: 500, maxDepth: 4 });
  assert.deepEqual(AI_LEVELS.hard, { timeMs: 900, maxDepth: 6 });
});

test('必杀局：能找到将死一步（三档难度）', () => {
  const { board, side } = mateInOneBoard();
  const opponent = side === 'w' ? 'b' : 'w';
  for (const level of LEVELS) {
    const mv = chooseMove(board, side, { level });
    assert.ok(mv, `${level} 未返回着法`);
    assert.ok(mv.from && mv.to, `${level} 返回结构缺少 from/to`);
    const next = applyMove(board, mv);
    const st = gameStatus(next, opponent);
    assert.equal(st.over, true, `${level} 选点 ${iccs(mv)} 未一步将死`);
    assert.equal(st.reason, 'checkmate', `${level} 选点 ${iccs(mv)} 应为将死`);
    assert.equal(st.winner, side, `${level} 胜方应为行棋方`);
  }
});

test('白吃悬空头车（固定局面断言应着）', () => {
  // 黑车 e6 悬空无根，红车 e1 可白吃（吃后无任何回吃）。
  const { board } = fromFEN('3k5/9/9/4r4/9/9/9/9/4R4/4K4 w');
  for (const level of LEVELS) {
    const mv = chooseMove(board, 'w', { level });
    assert.ok(mv, `${level} 未返回着法`);
    assert.deepEqual(
      { r: mv.from.r, c: mv.from.c },
      { r: 1, c: 4 },
      `${level} 起点应为 e1 红车（实际 ${iccs(mv)}）`,
    );
    assert.deepEqual(
      { r: mv.to.r, c: mv.to.c },
      { r: 6, c: 4 },
      `${level} 应白吃 e6 悬空黑车（实际 ${iccs(mv)}）`,
    );
  }
});

test('AI 自对弈 40 步全部合法', () => {
  let board = initialBoard();
  let side = 'w';
  let plies = 0;
  for (; plies < 40; plies++) {
    const mv = chooseMove(board, side, { level: 'easy' });
    assert.ok(mv, `第 ${plies + 1} 步 AI 未返回着法`);
    // makeMove 对非法着法抛错，这里兼做合法性断言
    board = makeMove(board, side, mv.from, mv.to);
    assert.ok(legalMoves(board, side === 'w' ? 'b' : 'w').length >= 0);
    side = side === 'w' ? 'b' : 'w';
    if (gameStatus(board, side).over) break;
  }
  assert.ok(plies === 40 || gameStatus(board, side).over, '对局应走满 40 步或正常终局');
});

test('各档位在时间预算内返回（hard 墙钟 <1.2s）', () => {
  const board = initialBoard();
  const limits = { easy: 400, normal: 700, hard: 1200 };
  const allRootMoves = legalMoves(board, 'w');
  for (const level of LEVELS) {
    const t0 = performance.now();
    const mv = chooseMove(board, 'w', { level });
    const dt = performance.now() - t0;
    assert.ok(mv, `${level} 未返回着法`);
    assert.ok(
      allRootMoves.some((m) => m.from.r === mv.from.r && m.from.c === mv.from.c && m.to.r === mv.to.r && m.to.c === mv.to.c),
      `${level} 返回着法 ${iccs(mv)} 不在合法着法内`,
    );
    assert.ok(dt < limits[level], `${level} 耗时 ${dt.toFixed(0)}ms 超过预算 ${limits[level]}ms`);
  }
});

test('同局面同难度两次结果一致', () => {
  // 选用搜索能在预算内完整跑完全部迭代深度的局面/档位组合，
  // 避免时间预算截断导致选点受机器速度影响（排序与决胜本身是确定性的）。
  const start = initialBoard();
  for (const level of ['easy', 'normal']) {
    const a = chooseMove(start, 'w', { level });
    const b = chooseMove(start, 'w', { level });
    assert.deepEqual({ from: a.from, to: a.to }, { from: b.from, to: b.to }, `${level} 两次选点不同`);
  }
  // 稀疏局面（双王+双车）normal 全深度可在数毫秒内完成
  const { board } = fromFEN('3k5/9/9/4r4/9/9/9/9/4R4/4K4 w');
  const a = chooseMove(board, 'w', { level: 'normal' });
  const b = chooseMove(board, 'w', { level: 'normal' });
  assert.deepEqual({ from: a.from, to: a.to }, { from: b.from, to: b.to }, 'normal（稀疏局面）两次选点不同');
});

test('将死局面无合法着法时返回 null', () => {
  const game = GAMES.find((g) => g.id === 'demo-chongppao');
  const rep = replayMoves(fromFEN(game.fen).board, 'w', game.moves.map((m) => m.iccs));
  assert.equal(rep.error, null);
  assert.equal(gameStatus(rep.finalBoard, rep.finalSide).over, true);
  assert.equal(chooseMove(rep.finalBoard, rep.finalSide, { level: 'normal' }), null);
});
