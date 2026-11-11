/**
 * 中国象棋 AI 引擎（纯函数、无 DOM 依赖，node --test 可直接 import）。
 * ------------------------------------------------------------------
 * 复用 ./xiangqi.js 规则引擎的走子生成 / 合法性 / 将军检测 API：
 *   - legalMoves（含送将禁手 + 照面过滤）
 *   - pseudoMoves / applyMove / kingsFacing / isCheck（静态搜索里的快速合法性过滤）
 *
 * 搜索：negamax + α-β 剪枝 + 迭代加深（时间预算内逐步加深），
 *       走法排序吃子优先（MVV-LVA），静态搜索（只吃子，≤3 层）抑制水平线效应。
 * 评估：子力价值 + 轻量位置项（过河兵加分、车炮活动度、被将军罚分）。
 * 无合法着法的节点按被将死 / 困毙打 -(MATE - ply) 分（ ply 越小分越差，即更快的杀更优）。
 *
 * 同分时按稳定顺序决胜（生成顺序 + 稳定排序），保证同局面同难度结果确定。
 */

import {
  ROWS, COLS, RED,
  colorOf, isRedSide, opponentOf,
  pieceMoves, pseudoMoves, legalMoves, applyMove,
  kingsFacing, isCheck, isCrossedRiver,
} from './xiangqi.js';

// ---------------------------------------------------------------- 参数

/** 三档难度：迭代加深的时间预算与最大深度。 */
export const AI_LEVELS = {
  easy: { timeMs: 200, maxDepth: 2 },
  normal: { timeMs: 500, maxDepth: 4 },
  hard: { timeMs: 900, maxDepth: 6 },
};

/** 子力价值（帅不参与吃子交换，仅作占位；兵过河翻倍）。 */
const VALUE = { K: 10000, R: 900, C: 450, N: 400, B: 200, A: 200, P: 100 };
const PAWN_CROSSED = 200;

/** 将杀分（远大于任何评估值）；越快的杀分越高（减 ply）。 */
const MATE = 100000;
const INFINITY_ = 2 * MATE;

/** 位置项权重（均为轻量项，量级远小于车/马子力差）。 */
const POS = {
  ROOK_MOBILITY: 2,      // 车每格活动度
  CANNON_MOBILITY: 1,    // 炮平移活动度
  CANNON_TARGET: 6,      // 炮隔子可打的目标
  CHECK_PENALTY: 25,     // 叶点被将军罚分
};

/** 静态搜索最大层数（只吃子）。 */
const QUIESCENCE_MAX = 3;

const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// ---------------------------------------------------------------- 评估

/**
 * 局面评估（从 side 视角返回分数）：
 * 子力（兵100/过河200，车900 炮450 马400 相/象200 士/仕200 帅10000）
 * + 车炮活动度 + 被将军罚分。
 */
export function evaluate(board, side) {
  let score = 0;
  for (let r = 0; r < ROWS; r++) {
    const row = board[r];
    for (let c = 0; c < COLS; c++) {
      const piece = row[c];
      if (!piece) continue;
      const type = piece.toUpperCase();
      const mine = colorOf(piece) === side;
      let value = VALUE[type];

      if (type === 'P') {
        if (isCrossedRiver(r, colorOf(piece))) value = PAWN_CROSSED; // 过河兵加分
      } else if (type === 'R') {
        value += POS.ROOK_MOBILITY * slideActivity(board, r, c);     // 车活动度
      } else if (type === 'C') {
        value += POS.CANNON_MOBILITY * slideActivity(board, r, c);   // 炮平移活动度
        value += POS.CANNON_TARGET * cannonTargets(board, r, c);     // 炮隔子可打
      }

      score += mine ? value : -value;
    }
  }
  // 被将军罚分（行棋方视角）
  if (isCheck(board, side)) score -= POS.CHECK_PENALTY;
  if (isCheck(board, opponentOf(side))) score += POS.CHECK_PENALTY;
  return score;
}

/** 直线滑行活动度：四方向上可直达的空格数（遇子即止，不 allocation）。 */
function slideActivity(board, r, c) {
  let count = 0;
  for (const [dr, dc] of ORTHO) {
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && !board[rr][cc]) {
      count++;
      rr += dr; cc += dc;
    }
  }
  return count;
}

/** 炮隔子可打目标数：越过第一个炮架后遇到的敌方子数（每方向至多 1）。 */
function cannonTargets(board, r, c) {
  const side = colorOf(board[r][c]);
  let count = 0;
  for (const [dr, dc] of ORTHO) {
    let rr = r + dr, cc = c + dc;
    let screenSeen = false;
    while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) {
      const p = board[rr][cc];
      if (p) {
        if (!screenSeen) {
          screenSeen = true;
        } else {
          if (colorOf(p) !== side) count++;
          break;
        }
      }
      rr += dr; cc += dc;
    }
  }
  return count;
}

// ---------------------------------------------------------------- 走法排序

/** MVV-LVA 吃子分：吃大子优先、用小子吃优先；不吃子 0 分。 */
function captureScore(move) {
  if (!move.captured) return 0;
  const victim = VALUE[move.captured.toUpperCase()];
  const attacker = VALUE[move.piece.toUpperCase()];
  return victim * 16 - attacker;
}

/**
 * 稳定排序走法：吃子优先（MVV-LVA），同分保持生成顺序。
 * 返回 [{ move, score }]，保证同局面同顺序 → 结果确定。
 */
function orderMoves(moves, priority) {
  const scored = moves.map((move, index) => ({
    move,
    score: captureScore(move),
    index,
    priority: priority && priority.from.r === move.from.r && priority.from.c === move.from.c
      && priority.to.r === move.to.r && priority.to.c === move.to.c ? 1 : 0,
  }));
  scored.sort((a, b) => b.priority - a.priority || b.score - a.score || a.index - b.index);
  return scored;
}

// ---------------------------------------------------------------- 搜索状态

let nodes = 0;
let deadline = 0;
let abortSearch = false;

function checkTime() {
  if ((++nodes & 63) !== 0) return;
  if (performance.now() >= deadline) abortSearch = true;
}

// ---------------------------------------------------------------- 静态搜索

/**
 * 静态搜索（quiescence）：叶点先算 stand-pat，再只扩展吃子着法（≤ QUIESCENCE_MAX 层）
 * 抑制水平线效应。合法性直接复用引擎：走后不被将军、双王不照面。
 */
function quiescence(board, side, alpha, beta, qdepth) {
  checkTime();
  if (abortSearch) return 0;

  const stand = evaluate(board, side);
  if (qdepth >= QUIESCENCE_MAX) return stand;
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;

  const sideOpp = opponentOf(side);
  const captures = pseudoMoves(board, side).filter((mv) => mv.captured);
  for (const { move } of orderMoves(captures)) {
    const next = applyMove(board, move);
    if (kingsFacing(next) || isCheck(next, side)) continue; // 非法（送将/照面）跳过
    const score = -quiescence(next, sideOpp, -beta, -alpha, qdepth + 1);
    if (abortSearch) return 0;
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

// ---------------------------------------------------------------- negamax

/**
 * negamax + α-β 剪枝。返回从 side 视角的分数。
 * 无合法着法 → 被将死/困毙：-(MATE - ply)（ply 越小扣得越多，快杀优于慢杀）。
 */
function negamax(board, side, depth, alpha, beta, ply) {
  checkTime();
  if (abortSearch) return 0;

  const moves = legalMoves(board, side);
  if (moves.length === 0) return -(MATE - ply);
  if (depth <= 0) return quiescence(board, side, alpha, beta, 0);

  const sideOpp = opponentOf(side);
  let best = -INFINITY_;
  for (const { move } of orderMoves(moves)) {
    const next = applyMove(board, move);
    const score = -negamax(next, sideOpp, depth - 1, -beta, -alpha, ply + 1);
    if (abortSearch) return 0;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // α-β 剪枝
  }
  return best;
}

// ---------------------------------------------------------------- 迭代加深根搜索

/**
 * 根搜索一层（指定深度），上一轮最佳着法优先排序。
 * 超时（abortSearch）时返回 null，调用方沿用上一已完成深度的结果。
 */
function searchRoot(board, side, depth, priority) {
  const moves = legalMoves(board, side);
  let alpha = -INFINITY_;
  let best = null;
  const sideOpp = opponentOf(side);
  for (const { move } of orderMoves(moves, priority)) {
    const next = applyMove(board, move);
    const score = -negamax(next, sideOpp, depth - 1, -INFINITY_, -alpha, 1);
    if (abortSearch) return null;
    if (!best || score > alpha) {
      alpha = score;
      best = { ...move, score };
    }
  }
  return best;
}

/**
 * 选着：negamax + α-β + 迭代加深。
 * @param {Array<Array<string|null>>} board 引擎棋盘
 * @param {'w'|'b'} side 行棋方
 * @param {{level?: 'easy'|'normal'|'hard'}} opts 难度（默认 normal）
 * @returns {{from:{r,c}, to:{r,c}, piece:string, captured:string|null, score:number}|null}
 *          无合法着法（已被将死/困毙）返回 null。
 */
export function chooseMove(board, side, opts = {}) {
  const level = AI_LEVELS[opts.level] ? opts.level : 'normal';
  const { timeMs, maxDepth } = AI_LEVELS[level];

  const moves = legalMoves(board, side);
  if (moves.length === 0) return null;
  if (moves.length === 1) return { ...moves[0], score: 0 };

  nodes = 0;
  abortSearch = false;
  deadline = performance.now() + timeMs;

  let best = null;
  for (let depth = 1; depth <= maxDepth; depth++) {
    const result = searchRoot(board, side, depth, best);
    if (abortSearch) break;      // 本层未完成 → 沿用上一层结果
    if (result) best = result;
  }

  if (!best) {
    // 兜底：时间预算极端情况下（理论上第一层必完成）按稳定顺序取首个着法
    return { ...orderMoves(moves)[0].move, score: 0 };
  }
  return best;
}
