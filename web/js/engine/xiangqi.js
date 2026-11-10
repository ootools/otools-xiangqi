/**
 * 中国象棋规则引擎（纯函数、无 DOM 依赖，node --test 可直接 import）。
 * ------------------------------------------------------------------
 * 坐标约定（与 ICCS 一致）：
 *   - 行 r: 0..9，r=0 为红方底线（红在下），r=9 为黑方底线（黑在上），河界介于 r=4/5 之间。
 *   - 列 c: 0..8，c=0 为 'a' 列（红方左手，红九路/黑 1 路），c=8 为 'i' 列（红一路/黑 9 路）。
 *   - 棋子字符：红方大写 R车 N马 B相 A仕 K帅 C炮 P兵；黑方小写 r n b a k c p。
 *   - 行棋方 side: 'w' 红方 / 'b' 黑方。
 *
 * 主要 API：
 *   initialBoard / legalMoves / isLegalMove / makeMove / applyMove
 *   isCheck / isCheckmate / isStuckmate / gameStatus
 *   toChineseNotation / moveToIccs / parseIccs
 *   toFEN / fromFEN / positionKey / validateSetup
 */

export const ROWS = 10;
export const COLS = 9;
export const RED = 'w';
export const BLACK = 'b';

/** 列号 'a'..'i' */
export const FILE_CHARS = 'abcdefghi';

// ------------------------------------------------------------------ 棋子

export const PIECES = {
  red: { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' },
  black: { K: '将', A: '士', B: '象', N: '马', R: '车', C: '炮', P: '卒' },
};

/** 棋子所属阵营：红大写、黑小写；空位返回 null。 */
export function colorOf(piece) {
  if (!piece) return null;
  return piece === piece.toUpperCase() ? RED : BLACK;
}

export function isRedSide(side) {
  return side === RED;
}

export function opponentOf(side) {
  return side === RED ? BLACK : RED;
}

// ------------------------------------------------------------------ 棋盘构造

/** 初始局面。 */
export function initialBoard() {
  const board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const back = 'RNBAKABNR';
  for (let c = 0; c < COLS; c++) {
    board[0][c] = back[c];          // 红方底线（r=0）
    board[9][c] = back[c].toLowerCase(); // 黑方底线（r=9）
  }
  board[2][1] = 'C'; board[2][7] = 'C';       // 红炮 b2/h2
  board[7][1] = 'c'; board[7][7] = 'c';       // 黑炮 b7/h7
  for (let c = 0; c < COLS; c += 2) {
    board[3][c] = 'P';                        // 红兵 a3 c3 e3 g3 i3
    board[6][c] = 'p';                        // 黑卒 a6 c6 e6 g6 i6
  }
  return board;
}

export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

// ------------------------------------------------------------------ 几何辅助

export function inBoard(r, c) {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

/** 九宫（红 r0..2 / 黑 r7..9，列 c3..c5）。 */
export function inPalace(r, c) {
  return c >= 3 && c <= 5 && (r <= 2 || r >= 7);
}

/** 相/象合法立足点：红 r∈{0,2,4}，黑 r∈{5,7,9}，列 ∈{0,2,4,6,8}。 */
export function isBishopSquare(r, c) {
  if (c % 2 !== 0) return false;
  return r % 2 === 0 && r <= 4 ? true : (r % 2 === 1 && r >= 5);
}

/** 未过河兵卒不能到达的格子校验用：兵是否已过河。 */
export function isCrossedRiver(r, side) {
  return isRedSide(side) ? r >= 5 : r <= 4;
}

export function findKing(board, side) {
  const target = isRedSide(side) ? 'K' : 'k';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] === target) return { r, c };
    }
  }
  return null;
}

/** 双王是否照面（同列且中间无子）。 */
export function kingsFacing(board) {
  const rk = findKing(board, RED);
  const bk = findKing(board, BLACK);
  if (!rk || !bk || rk.c !== bk.c) return false;
  for (let r = rk.r + 1; r < bk.r; r++) {
    if (board[r][rk.c]) return false;
  }
  return true;
}

// ------------------------------------------------------------------ 走子生成

const KNIGHT_OFFSETS = [
  [-2, -1], [-2, 1], [2, -1], [2, 1],
  [-1, -2], [-1, 2], [1, -2], [1, 2],
];

const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/** 马从 (r,c) 跳 (dr,dc) 的马腿格。 */
function knightLeg(r, c, dr, dc) {
  if (Math.abs(dr) === 2) return { r: r + dr / 2, c };
  return { r, c: c + dc / 2 };
}

/**
 * 生成 (r,c) 处棋子的所有伪合法走法（不含送将/照面过滤）。
 * 返回 [{from:{r,c}, to:{r,c}, piece, captured}]。
 */
export function pieceMoves(board, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const side = colorOf(piece);
  const type = piece.toUpperCase();
  const self = (rr, cc) => board[rr][cc] && colorOf(board[rr][cc]) === side;
  const moves = [];
  const push = (rr, cc) => {
    if (!inBoard(rr, cc) || self(rr, cc)) return;
    moves.push({ from: { r, c }, to: { r: rr, c: cc }, piece, captured: board[rr][cc] || null });
  };

  switch (type) {
    case 'R': { // 车：直线滑行
      for (const [dr, dc] of ORTHO) {
        let rr = r + dr, cc = c + dc;
        while (inBoard(rr, cc)) {
          if (board[rr][cc]) {
            if (colorOf(board[rr][cc]) !== side) push(rr, cc);
            break;
          }
          push(rr, cc);
          rr += dr; cc += dc;
        }
      }
      break;
    }
    case 'C': { // 炮：平移不吃子；隔一子吃
      for (const [dr, dc] of ORTHO) {
        let rr = r + dr, cc = c + dc;
        let jumped = false;
        while (inBoard(rr, cc)) {
          if (!board[rr][cc]) {
            if (!jumped) push(rr, cc);
          } else if (!jumped) {
            jumped = true; // 炮架
          } else {
            if (colorOf(board[rr][cc]) !== side) push(rr, cc);
            break;
          }
          rr += dr; cc += dc;
        }
      }
      break;
    }
    case 'N': { // 马：日字，蹩马腿
      for (const [dr, dc] of KNIGHT_OFFSETS) {
        const rr = r + dr, cc = c + dc;
        if (!inBoard(rr, cc)) continue;
        const leg = knightLeg(r, c, dr, dc);
        if (board[leg.r][leg.c]) continue;
        push(rr, cc);
      }
      break;
    }
    case 'B': { // 相/象：田字，塞象眼，不过河
      for (const [dr, dc] of [[-2, -2], [-2, 2], [2, -2], [2, 2]]) {
        const rr = r + dr, cc = c + dc;
        if (!inBoard(rr, cc)) continue;
        if (isRedSide(side) ? rr > 4 : rr < 5) continue; // 不过河
        if (board[r + dr / 2][c + dc / 2]) continue;     // 塞象眼
        push(rr, cc);
      }
      break;
    }
    case 'A': { // 仕/士：九宫斜行一格
      for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const rr = r + dr, cc = c + dc;
        if (!inPalace(rr, cc)) continue;
        push(rr, cc);
      }
      break;
    }
    case 'K': { // 帅/将：九宫直行一格（照面在合法性过滤统一处理）
      for (const [dr, dc] of ORTHO) {
        const rr = r + dr, cc = c + dc;
        if (!inPalace(rr, cc)) continue;
        push(rr, cc);
      }
      break;
    }
    case 'P': { // 兵/卒：过河前只进一格；过河后可进可平
      const dr = isRedSide(side) ? 1 : -1;
      push(r + dr, c);
      if (isCrossedRiver(r, side)) {
        push(r, c - 1);
        push(r, c + 1);
      }
      break;
    }
    default:
      break;
  }
  return moves;
}

/** 全部伪合法走法。 */
export function pseudoMoves(board, side) {
  const out = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const piece = board[r][c];
      if (piece && colorOf(piece) === side) out.push(...pieceMoves(board, r, c));
    }
  }
  return out;
}

// ------------------------------------------------------------------ 攻击/将军

/** (r,c) 是否被 bySide 一方攻击（车炮马兵帅仕相均可攻击）。 */
export function isSquareAttacked(board, r, c, bySide) {
  const isByRed = isRedSide(bySide);
  const enemyRook = isByRed ? 'R' : 'r';
  const enemyCannon = isByRed ? 'C' : 'c';
  const enemyKnight = isByRed ? 'N' : 'n';
  const enemyPawn = isByRed ? 'P' : 'p';
  const enemyAdvisor = isByRed ? 'A' : 'a';
  const enemyBishop = isByRed ? 'B' : 'b';
  const enemyKing = isByRed ? 'K' : 'k';

  // 车 / 炮：四条直线。扫描线上第一个子是炮架候选，第二个子若是敌方炮则为隔子打。
  for (const [dr, dc] of ORTHO) {
    let rr = r + dr, cc = c + dc;
    let screenSeen = false;
    while (inBoard(rr, cc)) {
      const p = board[rr][cc];
      if (p) {
        if (!screenSeen) {
          if (p === enemyRook) return true; // 车直接打（线上无遮挡）
          screenSeen = true;                // 任何子都可作敌方炮的炮架
        } else {
          if (p === enemyCannon) return true; // 隔一子打
          break;
        }
      }
      rr += dr; cc += dc;
    }
  }

  // 马：注意蹩腿（腿以马的位置计）
  for (const [dr, dc] of KNIGHT_OFFSETS) {
    const nr = r + dr, nc = c + dc;
    if (!inBoard(nr, nc) || board[nr][nc] !== enemyKnight) continue;
    const leg = knightLeg(nr, nc, -dr, -dc);
    if (!board[leg.r][leg.c]) return true;
  }

  // 兵：红兵攻击 (r-1,c) 与过河后的左右格；即从目标格反推
  if (isByRed) {
    if (inBoard(r - 1, c) && board[r - 1][c] === 'P') return true;
    if (r >= 5 && ((inBoard(r, c - 1) && board[r][c - 1] === 'P') || (inBoard(r, c + 1) && board[r][c + 1] === 'P'))) return true;
  } else {
    if (inBoard(r + 1, c) && board[r + 1][c] === 'p') return true;
    if (r <= 4 && ((inBoard(r, c - 1) && board[r][c - 1] === 'p') || (inBoard(r, c + 1) && board[r][c + 1] === 'p'))) return true;
  }

  // 帅/将贴身（照面情形之外，同宫相邻不可能出现，仅防御性检查）
  for (const [dr, dc] of ORTHO) {
    const rr = r + dr, cc = c + dc;
    if (inBoard(rr, cc) && board[rr][cc] === enemyKing) return true;
  }

  // 仕/相的攻击（可用于摆盘校验/通用攻击判断）
  for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const rr = r + dr, cc = c + dc;
    if (inBoard(rr, cc) && board[rr][cc] === enemyAdvisor) return true;
  }
  for (const [dr, dc] of [[-2, -2], [-2, 2], [2, -2], [2, 2]]) {
    const rr = r + dr, cc = c + dc;
    if (!inBoard(rr, cc) || board[rr][cc] !== enemyBishop) continue;
    if (!board[r + dr / 2][c + dc / 2]) return true;
  }
  return false;
}

/** side 一方的将/帅是否被将军。 */
export function isCheck(board, side) {
  const k = findKing(board, side);
  if (!k) return false;
  return isSquareAttacked(board, k.r, k.c, opponentOf(side));
}

// ------------------------------------------------------------------ 走子应用

/** 不做合法性校验直接走子（测试/内部用）。 */
export function applyMove(board, move) {
  const next = cloneBoard(board);
  next[move.from.r][move.from.c] = null;
  next[move.to.r][move.to.c] = move.piece;
  return next;
}

/** 合法走法过滤：走子后己方不被将军，且双王不照面。 */
function isMoveLegal(board, move) {
  const next = applyMove(board, move);
  const side = colorOf(move.piece);
  if (kingsFacing(next)) return false;
  return !isCheck(next, side);
}

export function legalMoves(board, side) {
  return pseudoMoves(board, side).filter((mv) => isMoveLegal(board, mv));
}

/** 判断 side 走 from→to 是否合法。 */
export function isLegalMove(board, side, from, to) {
  const piece = board[from.r] && board[from.r][from.c];
  if (!piece || colorOf(piece) !== side) return false;
  return legalMoves(board, side).some(
    (mv) => mv.from.r === from.r && mv.from.c === from.c && mv.to.r === to.r && mv.to.c === to.c,
  );
}

/** 校验并执行走子，返回新棋盘（非法则抛错）。 */
export function makeMove(board, side, from, to) {
  if (!isLegalMove(board, side, from, to)) {
    throw new Error(`非法着法: ${moveToIccs(from, to)}`);
  }
  return applyMove(board, { from, to, piece: board[from.r][from.c], captured: board[to.r][to.c] || null });
}

// ------------------------------------------------------------------ 终局判定

/**
 * 局面状态。
 * @returns {{over:boolean, inCheck:boolean, winner?:'w'|'b'|null, reason?:'checkmate'|'stuckmate'}}
 */
export function gameStatus(board, side) {
  const inCheck = isCheck(board, side);
  const moves = legalMoves(board, side);
  if (moves.length === 0) {
    // 无合法着法：被将军 → 将死；否则困毙，均判负（对方胜）
    return { over: true, inCheck, winner: opponentOf(side), reason: inCheck ? 'checkmate' : 'stuckmate' };
  }
  return { over: false, inCheck, winner: null };
}

export function isCheckmate(board, side) {
  const st = gameStatus(board, side);
  return st.over && st.reason === 'checkmate';
}

/** 困毙（无子可动且未被将军，同样判负）。 */
export function isStuckmate(board, side) {
  const st = gameStatus(board, side);
  return st.over && st.reason === 'stuckmate';
}

// ------------------------------------------------------------------ ICCS 与 FEN

/** 走法转 ICCS（如 "H2-E2"，列字母 + 行数字，红底线为 0）。 */
export function moveToIccs(from, to) {
  const sq = (r, c) => `${FILE_CHARS[c].toUpperCase()}${r}`;
  return `${sq(from.r, from.c)}-${sq(to.r, to.c)}`;
}

export function moveOfIccs(iccs) {
  const m = parseIccs(iccs);
  return { from: m.from, to: m.to, piece: null, captured: null };
}

/** 解析 ICCS 字符串（大小写均可），非法则抛错。 */
export function parseIccs(iccs) {
  const text = String(iccs || '').trim();
  const m = /^([A-Ia-i])([0-9])\s*-\s*([A-Ia-i])([0-9])$/.exec(text);
  if (!m) throw new Error(`无法解析 ICCS: ${iccs}`);
  const sq = (fileCh, rankCh) => ({ r: Number(rankCh), c: FILE_CHARS.indexOf(fileCh.toLowerCase()) });
  return { from: sq(m[1], m[2]), to: sq(m[3], m[4]) };
}

/** 序列化为标准 Xiangqi FEN（如 "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w"）。 */
export function toFEN(board, side) {
  const rows = [];
  for (let r = ROWS - 1; r >= 0; r--) {
    let row = '';
    let empty = 0;
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (p) {
        if (empty) { row += String(empty); empty = 0; }
        row += p;
      } else {
        empty++;
      }
    }
    if (empty) row += String(empty);
    rows.push(row);
  }
  return `${rows.join('/')} ${side === BLACK ? 'b' : 'w'}`;
}

/** 解析 FEN（结构非法则抛错）。 */
export function fromFEN(fen) {
  const text = String(fen || '').trim();
  const parts = text.split(/\s+/);
  if (parts.length < 2) throw new Error(`无法解析 FEN: ${fen}`);
  const [rowsPart, sidePart] = parts;
  const rows = rowsPart.split('/');
  if (rows.length !== ROWS) throw new Error(`FEN 行数错误: ${fen}`);
  const board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (let i = 0; i < ROWS; i++) {
    const r = ROWS - 1 - i;
    let c = 0;
    for (const ch of rows[i]) {
      if (/[1-9]/.test(ch)) {
        c += Number(ch);
      } else if (/[rnbakcpRNBAKCP]/.test(ch)) {
        if (c >= COLS) throw new Error(`FEN 列越界: ${fen}`);
        board[r][c] = ch;
        c += 1;
      } else {
        throw new Error(`FEN 含非法字符 '${ch}': ${fen}`);
      }
    }
    if (c !== COLS) throw new Error(`FEN 行长度错误: ${fen}`);
  }
  const side = sidePart === 'b' ? BLACK : sidePart === 'w' ? RED : null;
  if (!side) throw new Error(`FEN 行棋方错误: ${fen}`);
  return { board, side };
}

/** 重复局面判定键：FEN（含行棋方）。 */
export function positionKey(board, side) {
  return toFEN(board, side);
}

// ------------------------------------------------------------------ 摆盘校验

const MAX_COUNTS = { K: 1, A: 2, B: 2, N: 2, R: 2, C: 2, P: 5 };

/**
 * 校验摆盘局面是否可作为对局起点（基本项）：
 * 双方有王且王在九宫、士相在合法立足点、兵不过河不落后场且数量合法、无照面、各子数量合法。
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateSetup(board) {
  const errors = [];
  const counts = { w: {}, b: {} };

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (!p) continue;
      const side = colorOf(p);
      const type = p.toUpperCase();
      counts[side][type] = (counts[side][type] || 0) + 1;

      if (type === 'K') {
        if (!inPalace(r, c)) errors.push('将/帅必须在九宫内');
      } else if (type === 'A') {
        if (!inPalace(r, c)) errors.push('仕/士必须在九宫内');
      } else if (type === 'B') {
        if (!isBishopSquare(r, c)) errors.push('相/象必须位于本方河界以内的合法象位');
        else if (isRedSide(side) ? r > 4 : r < 5) errors.push('相/象不能过河');
      } else if (type === 'P') {
        if (isRedSide(side) && r < 3) errors.push('红兵不能位于未开进过的后场（r≥3）');
        if (!isRedSide(side) && r > 6) errors.push('黑卒不能位于未开进过的后场（r≤6）');
      }
    }
  }

  for (const side of [RED, BLACK]) {
    const who = isRedSide(side) ? '红方' : '黑方';
    if (!counts[side].K) errors.push(`${who}缺少将/帅`);
    for (const [type, max] of Object.entries(MAX_COUNTS)) {
      const n = counts[side][type] || 0;
      if (n > max) errors.push(`${who}${PIECES.red[type]}超出数量上限（${n}>${max}）`);
    }
  }

  if (kingsFacing(board)) errors.push('双王照面（中间无隔子）为非法局面');

  return { ok: errors.length === 0, errors };
}

// ------------------------------------------------------------------ 中文纵线记谱

const RED_FILE_CHARS = ['九', '八', '七', '六', '五', '四', '三', '二', '一']; // c=0..8
const RED_NUM_CHARS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];   // 步数 1..9

function fileLabel(c, side) {
  return isRedSide(side) ? RED_FILE_CHARS[c] : String(c + 1);
}

function countLabel(n, side) {
  return isRedSide(side) ? RED_NUM_CHARS[n - 1] : String(n);
}

/**
 * 中文纵线记谱（基于走子前的局面）。
 * 例如红方 H2-E2 → "炮二平五"；黑方 b9-a7 → "马2进1"；同列双子 → "前车进一" 等。
 */
export function toChineseNotation(board, side, from, to) {
  const piece = board[from.r] && board[from.r][from.c];
  if (!piece) throw new Error(`记谱失败: 起点无子 ${moveToIccs(from, to)}`);
  if (colorOf(piece) !== side) throw new Error(`记谱失败: 起点非行棋方之子 ${moveToIccs(from, to)}`);

  const type = piece.toUpperCase();
  const names = isRedSide(side) ? PIECES.red : PIECES.black;
  const name = names[type];

  // 同列同种双子区分：前/后（兵三子以上用 前/中/后）
  const sameFile = [];
  for (let r = 0; r < ROWS; r++) {
    if (r !== from.r && board[r][from.c] === piece) sameFile.push(r);
  }
  let prefix = '';
  if (sameFile.length > 0) {
    // 前 = 更靠近敌方（红方 r 大者为前，黑方 r 小者为前）
    const rowsAsc = [...sameFile, from.r].sort((a, b) => a - b);
    const order = isRedSide(side) ? rowsAsc.slice().reverse() : rowsAsc; // order[0] = 前
    const idx = order.indexOf(from.r);
    if (order.length === 2) {
      prefix = idx === 0 ? '前' : '后';
    } else if (order.length === 3) {
      prefix = idx === 0 ? '前' : idx === order.length - 1 ? '后' : '中';
    } else {
      prefix = idx === 0 ? '前' : idx === order.length - 1 ? '后' : '中'; // 兵三子以上简化
    }
    return `${prefix}${name}${directionAndDest(board, side, from, to, type, true)}`;
  }

  return `${name}${fileLabel(from.c, side)}${directionAndDest(board, side, from, to, type, false)}`;
}

function directionAndDest(board, side, from, to, type, prefixed) {
  const dr = to.r - from.r;
  const dirChar = dr === 0 ? '平' : (dr > 0) === isRedSide(side) ? '进' : '退';
  if (dr === 0) {
    return `${dirChar}${fileLabel(to.c, side)}`;
  }
  // 斜行子（马相象仕）进退以目标纵线计；直行子（车炮兵将）以步数计
  if (type === 'N' || type === 'B' || type === 'A') {
    return `${dirChar}${fileLabel(to.c, side)}`;
  }
  return `${dirChar}${countLabel(Math.abs(dr), side)}`;
}

// ------------------------------------------------------------------ 便捷局面工具

/** 由 ICCS 序列在给定起始局面/行棋方下推进，返回 {boards, sides, notations, finalSide, error}。
 *  棋谱数据校验与 UI 播放共用；遇到非法着法即停止并在 error 里说明。 */
export function replayMoves(board, side, iccsList) {
  const boards = [cloneBoard(board)];
  const sides = [side];
  const notations = [];
  let curBoard = cloneBoard(board);
  let curSide = side;
  let error = null;
  for (let i = 0; i < iccsList.length; i++) {
    let from, to;
    try {
      ({ from, to } = parseIccs(iccsList[i]));
    } catch (e) {
      error = `第 ${i + 1} 着 ICCS 无法解析: ${iccsList[i]}`;
      break;
    }
    if (!isLegalMove(curBoard, curSide, from, to)) {
      error = `第 ${i + 1} 着非法: ${iccsList[i]}（${isRedSide(curSide) ? '红' : '黑'}方）`;
      break;
    }
    notations.push(toChineseNotation(curBoard, curSide, from, to));
    curBoard = applyMove(curBoard, { from, to, piece: curBoard[from.r][from.c], captured: curBoard[to.r][to.c] || null });
    curSide = opponentOf(curSide);
    boards.push(cloneBoard(curBoard));
    sides.push(curSide);
  }
  return { boards, sides, notations, finalBoard: curBoard, finalSide: curSide, error };
}
