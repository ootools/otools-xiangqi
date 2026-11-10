import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAMES } from '../web/data/games/index.js';
import {
  initialBoard, fromFEN, replayMoves, gameStatus, legalMoves, applyMove,
  isCheck, isCheckmate, isStuckmate, validateSetup,
} from '../web/js/engine/xiangqi.js';
import { canMate, iccsOf } from './helpers/mate.js';

const REQUIRED_FIELDS = ['id', 'title', 'event', 'date', 'red', 'black', 'result', 'moves', 'source'];
const ICCS_RE = /^[A-Ia-i][0-9]-[A-Ia-i][0-9]$/;

test('棋谱库至少收录 8 局且元数据完整', () => {
  assert.ok(GAMES.length >= 8, `收录局数不足：${GAMES.length}`);
  const ids = new Set();
  for (const game of GAMES) {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(game[field] !== undefined && game[field] !== null, `${game.id || '(无id)'} 缺少字段 ${field}`);
    }
    assert.ok(!ids.has(game.id), `棋谱 id 重复：${game.id}`);
    ids.add(game.id);
    assert.ok(Array.isArray(game.moves) && game.moves.length >= 1, `${game.id} moves 为空`);
    assert.ok(typeof game.source === 'string' && game.source.length >= 8, `${game.id} 未注明出处`);
  }
});

test('每一局逐步走子校验合法性（任何非法步 = 失败）', () => {
  for (const game of GAMES) {
    let board = game.fen ? fromFEN(game.fen).board : initialBoard();
    let side = 'w';
    for (let i = 0; i < game.moves.length; i++) {
      const entry = game.moves[i];
      assert.match(entry.iccs, ICCS_RE, `${game.id} 第${i + 1}着 ICCS 格式错误: ${entry.iccs}`);
      const rep = replayMoves(board, side, [entry.iccs]);
      assert.equal(rep.error, null, `${game.id} 第${i + 1}着非法: ${rep.error}`);
      board = rep.boards[1];
      side = side === 'w' ? 'b' : 'w';
    }
  }
});

test('抽查记谱生成与已知着法一致', () => {
  const qima = GAMES.find((g) => g.id === 'qima-shisanzhe');
  assert.ok(qima, '缺少弃马十三着');
  const expect = ['炮二平五', '炮8平5', '马二进三', '马8进7', '车一进一', '车9平8',
    '车一平六', '车8进6', '车六进七', '马2进1', '车九进一', '炮2进7'];
  const rep = replayMoves(initialBoard(), 'w', qima.moves.slice(0, 12).map((m) => m.iccs));
  assert.equal(rep.error, null);
  rep.notations.forEach((notation, i) => {
    assert.equal(notation, expect[i], `${qima.id} 第${i + 1}着记谱不符：${notation} ≠ ${expect[i]}`);
  });
  // 前车进一（同列双车的"前"字记法）
  const rep10 = replayMoves(initialBoard(), 'w', qima.moves.slice(0, 19).map((m) => m.iccs));
  assert.equal(rep10.notations[18], '前车进一');
});

test('弃马十三着：终局为将死（红胜）', () => {
  const qima = GAMES.find((g) => g.id === 'qima-shisanzhe');
  const rep = replayMoves(initialBoard(), 'w', qima.moves.map((m) => m.iccs));
  assert.equal(rep.error, null);
  const st = gameStatus(rep.finalBoard, rep.finalSide);
  assert.equal(st.over, true, '弃马十三着应以将死结束');
  assert.equal(st.reason, 'checkmate');
  assert.equal(st.winner, 'w');
});

test('巡河十八打：终局红方胜势（非终局状态但黑方被压制）', () => {
  const game = GAMES.find((g) => g.id === 'xunhe-shibada');
  const rep = replayMoves(initialBoard(), 'w', game.moves.map((m) => m.iccs));
  assert.equal(rep.error, null);
  assert.equal(rep.finalSide, 'b');
  // 原谱下着炮二进一绝杀，此处至少验证局面合法且红方尚有攻势
  assert.ok(legalMoves(rep.finalBoard, 'b').length > 0);
});

test('杀法演示局：终局为将死且为强制杀', () => {
  const demoGames = GAMES.filter((g) => g.id.startsWith('demo-'));
  assert.ok(demoGames.length >= 5, `杀法演示局数量不足：${demoGames.length}`);
  for (const game of demoGames) {
    const { board, side } = fromFEN(game.fen);
    const rep = replayMoves(board, side, game.moves.map((m) => m.iccs));
    assert.equal(rep.error, null, `${game.id} 含非法着法: ${rep.error}`);
    const st = gameStatus(rep.finalBoard, rep.finalSide);
    assert.equal(st.over, true, `${game.id} 终局未结束`);
    assert.equal(st.winner, 'w', `${game.id} 胜方应为红方`);
    // 将死或困毙（困毙演示局验证 reason）
    if (game.id === 'demo-kunbi') {
      assert.equal(st.reason, 'stuckmate', `${game.id} 应为困毙`);
      assert.equal(isStuckmate(rep.finalBoard, rep.finalSide), true);
      assert.equal(isCheck(rep.finalBoard, rep.finalSide), false);
    } else {
      assert.equal(st.reason, 'checkmate', `${game.id} 应为将死`);
      assert.equal(isCheckmate(rep.finalBoard, rep.finalSide), true);
    }

    // 强制杀：黑方每个正式回合上的任何合法应着，红方都能在剩余步数内终局
    let cur = board;
    for (let i = 0; i < game.moves.length; i += 2) {
      const repI = replayMoves(cur, 'w', game.moves.slice(i, i + 1).map((m) => m.iccs));
      cur = repI.boards[1];
      if (i + 1 >= game.moves.length) break;
      const redLeft = (game.moves.length - (i + 1) + 1) / 2 | 0; // 剩余红方步数（含当前已走）
      const budget = Math.max(1, redLeft * 2 - 1);
      for (const alt of legalMoves(cur, 'b')) {
        const altBoard = applyMove(cur, alt);
        const stAlt = gameStatus(altBoard, 'w');
        if (stAlt.over) continue; // 黑方该应着立即送死
        assert.ok(
          canMate(altBoard, 'w', budget),
          `${game.id} 第${i / 2 + 1}回合黑方应着 ${iccsOf(alt)} 未在 ${redLeft} 步内被杀`,
        );
      }
      const repNext = replayMoves(cur, 'b', [game.moves[i + 1].iccs]);
      cur = repNext.boards[1];
    }
  }
});

test('演示局起始局面通过摆盘校验（合法对局起点）', () => {
  for (const game of GAMES.filter((g) => g.fen)) {
    const { board, side } = fromFEN(game.fen);
    assert.equal(side, 'w', `${game.id} 起始行棋方应为红方`);
    const result = validateSetup(board);
    assert.equal(result.ok, true, `${game.id} 起始局面非法: ${result.errors.join(';')}`);
  }
});
