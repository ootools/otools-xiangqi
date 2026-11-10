/**
 * UI 主逻辑：三个页签（对弈 / 排盘 / 摆盘）、棋谱导入导出、localStorage 进度保存。
 */
import {
  initialBoard, cloneBoard, legalMoves, makeMove, applyMove, gameStatus, isCheck,
  toFEN, fromFEN, toChineseNotation, parseIccs, positionKey, validateSetup,
  colorOf, isRedSide, PIECES, findKing, replayMoves,
} from '../engine/xiangqi.js';
import { GAMES } from '../../data/games/index.js';
import { renderBoard, onBoardClick } from './board.js';

const $ = (id) => document.getElementById(id);
const PLUGIN = () => window.otoolsPlugin || null;
const STORE_KEY = 'otools-xiangqi.play';

// ---------------------------------------------------------------- 通用 UI

let toastTimer = null;
function toast(message, kind = '') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function setStatus(el, text, kind = '') {
  el.textContent = text;
  el.className = `status-card ${kind}`.trim();
}

function downloadText(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportText(name, text) {
  const plugin = PLUGIN();
  if (plugin && plugin.available()) {
    try {
      const path = await plugin.saveText(name, text);
      if (path) { toast(`已保存：${path}`, 'good'); return; }
      toast('已取消保存');
      return;
    } catch (err) {
      toast(`宿主保存失败，已退回浏览器下载：${err.message}`, 'bad');
    }
  }
  downloadText(name, text);
  toast('已通过浏览器下载', 'good');
}

async function importText(filters) {
  const plugin = PLUGIN();
  if (plugin && plugin.available()) {
    try {
      const result = await plugin.openText(filters);
      if (result) return result;
      return null;
    } catch (err) {
      toast(`宿主打开失败，退回浏览器选择：${err.message}`, 'bad');
    }
  }
  return new Promise((resolve) => {
    const input = $('fileInput');
    input.value = '';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, text: String(reader.result || '') });
      reader.onerror = () => { toast('读取文件失败', 'bad'); resolve(null); };
      reader.readAsText(file);
    };
    input.click();
  });
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast('已复制到剪贴板', 'good'),
      () => toast('复制失败，请手动选择文本复制', 'bad'),
    );
  } else {
    toast('请手动选择文本复制', 'bad');
  }
}

// ---------------------------------------------------------------- 棋盘视图状态

const boardEl = $('board');
const boardWrap = $('boardWrap');
let view = {
  board: initialBoard(),
  selected: null,   // {r,c}
  targets: [],      // [{r,c}]
  lastMove: null,   // {from, to}
  checkedKing: null,
};

function repaint() {
  renderBoard(boardEl, view.board, {
    selected: view.selected,
    targets: view.targets,
    lastMove: view.lastMove,
    checkedKing: view.checkedKing,
  });
}

function setBoard(board, extras = {}) {
  view.board = cloneBoard(board);
  Object.assign(view, extras);
  const sideToMove = extras.sideToMove || null;
  if (sideToMove && isCheck(view.board, sideToMove)) {
    view.checkedKing = findKing(view.board, sideToMove);
  } else {
    view.checkedKing = null;
  }
  repaint();
}

onBoardClick(boardEl, (point) => handlers[activeTab] && handlers[activeTab](point));
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => repaint()).observe(boardWrap);
}
window.addEventListener('resize', repaint);

// ---------------------------------------------------------------- 页签

let activeTab = 'play';
const handlers = {};

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('#tabs .tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.panel-page').forEach((page) => {
    page.classList.toggle('active', page.id === `panel-${tab}`);
  });
  repaint();
}
document.querySelectorAll('#tabs .tab').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ---------------------------------------------------------------- 对弈模式

const play = {
  startFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',
  board: initialBoard(),
  side: 'w',
  history: [], // {iccs, notation, fenBefore, side}
  over: false,
};

function playSave() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      startFen: play.startFen,
      moves: play.history.map((h) => ({ iccs: h.iccs, notation: h.notation })),
      savedAt: Date.now(),
    }));
  } catch (e) { /* 存储不可用时静默 */ }
}

function playRestore() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { saved = null; }
  if (!saved || !Array.isArray(saved.moves) || !saved.startFen) return false;
  const isInitialFen = saved.startFen === 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';
  let board;
  try { board = fromFEN(saved.startFen).board; } catch (e) { return false; }
  let side = 'w';
  play.history = [];
  for (const entry of saved.moves) {
    const rep = replayOne(board, side, entry.iccs, entry.notation);
    if (!rep) return false;
    board = rep.board;
    side = rep.side;
    play.history.push(rep.record);
  }
  play.startFen = saved.startFen;
  play.board = board;
  play.side = side;
  play.over = gameStatus(board, side).over;
  return play.history.length > 0 || !isInitialFen;
}

function replayOne(board, side, iccs, notation) {
  let from, to;
  try {
    ({ from, to } = parseIccs(iccs));
  } catch (e) { return null; }
  if (!legalMoves(board, side).some((mv) => mv.from.r === from.r && mv.from.c === from.c && mv.to.r === to.r && mv.to.c === to.c)) {
    return null;
  }
  const note = notation || toChineseNotation(board, side, from, to);
  const piece = board[from.r][from.c];
  const record = { iccs, notation: note, fenBefore: toFEN(board, side), side, from, to };
  const next = applyMove(board, { from, to, piece, captured: board[to.r][to.c] || null });
  return { board: next, side: side === 'w' ? 'b' : 'w', record };
}

function renderPlayMoves() {
  const list = $('playMoveList');
  if (play.history.length === 0) {
    list.innerHTML = '<div class="move-empty">尚未行棋，红方先行。</div>';
    return;
  }
  const rows = [];
  for (let i = 0; i < play.history.length; i += 2) {
    const red = play.history[i];
    const black = play.history[i + 1];
    rows.push(
      `<div class="move-row"><span class="no">${i / 2 + 1}.</span>` +
      `<span class="mv red">${red ? red.notation : ''}</span>` +
      `<span class="mv black">${black ? black.notation : ''}</span></div>`,
    );
  }
  list.innerHTML = rows.join('');
  list.scrollTop = list.scrollHeight;
}

function playUpdateStatus() {
  const el = $('playStatus');
  if (play.over) {
    const st = gameStatus(play.board, play.side);
    const loser = isRedSide(play.side) ? '红方' : '黑方';
    const winner = isRedSide(play.side) ? '黑方' : '红方';
    setStatus(el, `终局：${st.reason === 'checkmate' ? `${loser}被将死` : `${loser}困毙`}，${winner}胜（点“重新开始”再来一局）`, 'good');
    return;
  }
  const counts = {};
  let b = play.startFen ? fromFEN(play.startFen).board : initialBoard();
  let s = 'w';
  const keys = [positionKey(b, s)];
  for (const h of play.history) {
    const rep = replayOne(b, s, h.iccs, h.notation);
    b = rep.board; s = rep.side;
    keys.push(positionKey(b, s));
  }
  const currentKey = keys[keys.length - 1];
  const occurrences = keys.filter((k) => k === currentKey).length;
  const sideName = isRedSide(play.side) ? '红方' : '黑方';
  const inCheck = isCheck(play.board, play.side);
  if (occurrences >= 3) {
    setStatus(el, `将军！${sideName}行棋 · 注意：当前局面第三次重复（简化处理，不自动判负；长将/长捉判负未实现）`, inCheck ? 'warn' : '');
  } else if (inCheck) {
    setStatus(el, `将军！${sideName}行棋`, 'warn');
  } else {
    setStatus(el, `${sideName}行棋`);
  }
}

function playRefresh(extras = {}) {
  setBoard(play.board, {
    lastMove: play.history.length ? { from: play.history[play.history.length - 1].from, to: play.history[play.history.length - 1].to } : null,
    sideToMove: play.over ? null : play.side,
    ...extras,
  });
  view.targets = [];
  view.selected = null;
  renderPlayMoves();
  playUpdateStatus();
  playSave();
}

handlers.play = (point) => {
  if (play.over) { toast('对局已结束，请重新开始'); return; }
  const piece = play.board[point.r][point.c];
  const mine = piece && colorOf(piece) === play.side;

  if (view.selected && view.targets.some((t) => t.r === point.r && t.c === point.c)) {
    // 走子
    const from = view.selected;
    const notation = toChineseNotation(play.board, play.side, from, point);
    const pieceMoving = play.board[from.r][from.c];
    const record = {
      iccs: `${'abcdefghi'[from.c].toUpperCase()}${from.r}-${'abcdefghi'[point.c].toUpperCase()}${point.r}`,
      notation,
      fenBefore: toFEN(play.board, play.side),
      side: play.side,
      from, to: point,
    };
    play.board = makeMove(play.board, play.side, from, point);
    play.side = play.side === 'w' ? 'b' : 'w';
    play.history.push(record);
    const st = gameStatus(play.board, play.side);
    play.over = st.over;
    playRefresh();
    if (st.over) {
      const loser = isRedSide(play.side) ? '红方' : '黑方';
      const winner = isRedSide(play.side) ? '黑方' : '红方';
      toast(st.reason === 'checkmate' ? `将死！${winner}获胜` : `困毙！${winner}获胜`, 'good');
    } else if (st.inCheck) {
      toast('将军！');
    }
    return;
  }

  if (mine) {
    if (view.selected && view.selected.r === point.r && view.selected.c === point.c) {
      view.selected = null;
      view.targets = [];
    } else {
      view.selected = point;
      view.targets = legalMoves(play.board, play.side)
        .filter((mv) => mv.from.r === point.r && mv.from.c === point.c)
        .map((mv) => mv.to);
    }
  } else {
    view.selected = null;
    view.targets = [];
  }
  repaint();
};

$('btnUndo').addEventListener('click', () => {
  if (play.history.length === 0) { toast('没有可悔的棋'); return; }
  const last = play.history.pop();
  const { board, side } = fromFEN(last.fenBefore);
  play.board = board;
  play.side = side;
  play.over = gameStatus(board, side).over;
  playRefresh();
  toast('已悔一着');
});

$('btnRestart').addEventListener('click', () => {
  play.board = play.startFen && play.startFen !== 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w'
    ? fromFEN(play.startFen).board
    : initialBoard();
  play.side = 'w';
  play.history = [];
  play.over = false;
  playRefresh();
  toast('新的一局开始，红方先行', 'good');
});

$('btnExportGame').addEventListener('click', () => {
  const payload = {
    app: 'otools-xiangqi',
    type: 'game',
    version: 1,
    startFen: play.startFen,
    result: play.over ? gameStatus(play.board, play.side).reason : '',
    moves: play.history.map((h) => ({ iccs: h.iccs, notation: h.notation })),
  };
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  exportText(`xiangqi-duiju-${stamp}.json`, JSON.stringify(payload, null, 2));
});

$('btnImportGame').addEventListener('click', async () => {
  const file = await importText([{ name: '棋谱 JSON', extensions: ['json'] }]);
  if (!file) { toast('已取消'); return; }
  let payload;
  try { payload = JSON.parse(file.text); } catch (e) { toast('JSON 解析失败', 'bad'); return; }
  const moves = Array.isArray(payload) ? payload : payload.moves;
  const startFen = typeof payload.startFen === 'string' ? payload.startFen : null;
  if (!Array.isArray(moves) || moves.length === 0) { toast('棋谱中没有着法', 'bad'); return; }
  // 校验逐步合法
  let board = startFen ? fromFEN(startFen).board : initialBoard();
  let side = 'w';
  const validated = [];
  for (const entry of moves) {
    const rep = replayOne(board, side, entry.iccs, entry.notation);
    if (!rep) { toast(`第 ${validated.length + 1} 着非法（${entry.iccs}），导入中止`, 'bad'); return; }
    board = rep.board;
    side = rep.side;
    validated.push(rep.record);
  }
  play.startFen = startFen || 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';
  play.board = board;
  play.side = side;
  play.history = validated;
  play.over = gameStatus(board, side).over;
  playRefresh();
  switchTab('play');
  toast(`已导入「${file.name}」共 ${validated.length} 着`, 'good');
});

// ---------------------------------------------------------------- 排盘模式

const replayState = {
  gameId: null,
  boards: [],
  plies: [],      // {iccs, notation}
  comments: [],
  index: 0,       // 0 = 初始局面；n = 走完 n 着后
  timer: null,
};

function replayStop() {
  if (replayState.timer) {
    clearInterval(replayState.timer);
    replayState.timer = null;
    $('rpPlay').textContent = '▶ 自动';
  }
}

function replayMeta(game) {
  return `<div class="game-item" data-id="${game.id}">
    <div class="g-title">${game.title}（${game.result}）</div>
    <div class="g-meta">${game.event}${game.date ? ' · ' + game.date : ''}</div>
  </div>`;
}

function replayLoad(gameId) {
  replayStop();
  const game = GAMES.find((g) => g.id === gameId);
  if (!game) return;
  let board = game.fen ? fromFEN(game.fen).board : initialBoard();
  let side = 'w';
  const boards = [cloneBoard(board)];
  const plies = [];
  const comments = [null];
  for (const entry of game.moves) {
    const rep = replayMoves(board, side, [entry.iccs]);
    if (rep.error) break;
    const { from, to } = parseIccs(entry.iccs);
    plies.push({
      iccs: entry.iccs,
      notation: toChineseNotation(board, side, from, to),
      side,
      from, to,
    });
    comments.push(entry.comment || null);
    board = rep.boards[1];
    side = side === 'w' ? 'b' : 'w';
    boards.push(cloneBoard(board));
  }
  Object.assign(replayState, { gameId, boards, plies, comments, index: 0 });
  document.querySelectorAll('#gameList .game-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === gameId);
  });
  replayShow(0, true);
}

function replayShow(index, resetView = false) {
  replayState.index = Math.max(0, Math.min(replayState.index, replayState.boards.length - 1));
  const idx = index !== undefined ? index : replayState.index;
  replayState.index = Math.max(0, Math.min(idx, replayState.boards.length - 1));
  const board = replayState.boards[replayState.index];
  const sideToMove = replayState.index % 2 === 0 ? 'w' : 'b';
  const last = replayState.index > 0 ? replayState.plies[replayState.index - 1] : null;
  setBoard(board, {
    lastMove: last ? { from: last.from, to: last.to } : null,
    sideToMove,
  });
  const game = GAMES.find((g) => g.id === replayState.gameId);
  const el = $('replayStatus');
  if (!game) {
    setStatus(el, '选择一局名局开始打谱');
  } else if (replayState.index === 0) {
    setStatus(el, `${game.title} · 初始局面（红方 ${game.red} 先行）`);
  } else {
    const step = replayState.plies[replayState.index - 1];
    const checked = isCheck(board, sideToMove);
    const st = gameStatus(board, sideToMove);
    const tail = st.over ? (st.reason === 'checkmate' ? ' · 将死' : ' · 困毙') : (checked ? ' · 将军！' : '');
    setStatus(el, `${game.title} · 第 ${Math.ceil(replayState.index / 2)} 回合 ${isRedSide(step.side) ? '红' : '黑'}：${step.notation}${tail}`,
      checked || st.over ? 'warn' : '');
  }
  const comment = replayState.comments[replayState.index];
  $('replayComment').textContent = comment
    ? `第 ${Math.ceil(replayState.index / 2)} 回合 ${replayState.plies[replayState.index - 1].notation}：${comment}`
    : (replayState.index === 0 ? `对局：${game ? game.event : ''}。点击棋谱列表任意着法可跳转。` : '本着无注解。');
  // 列表渲染（着法用中文记谱）
  const list = $('replayMoveList');
  if (!game) { list.innerHTML = ''; return; }
  const rows = [];
  for (let i = 0; i < replayState.plies.length; i += 2) {
    const red = replayState.plies[i];
    const black = replayState.plies[i + 1];
    const mark = (ply) => replayState.index === ply ? 'current' : '';
    rows.push(
      `<div class="move-row"><span class="no">${i / 2 + 1}.</span>` +
      `<span class="mv red ${mark(i + 1)}" data-ply="${i + 1}">${red.notation}</span>` +
      `<span class="mv black ${mark(i + 2)}" data-ply="${i + 2}">${black ? black.notation : ''}</span></div>`,
    );
  }
  list.innerHTML = rows.join('');
  const current = list.querySelector('.current');
  if (current) current.scrollIntoView({ block: 'nearest' });
}

function replayStep(delta) {
  replayStop();
  replayShow(replayState.index + delta);
}

function replayToggleAuto() {
  if (replayState.timer) { replayStop(); return; }
  if (replayState.index >= replayState.boards.length - 1) replayShow(0);
  const speed = Number($('rpSpeed').value) || 1200;
  replayState.timer = setInterval(() => {
    if (replayState.index >= replayState.boards.length - 1) {
      replayStop();
      return;
    }
    replayShow(replayState.index + 1);
  }, speed);
  $('rpPlay').textContent = '⏸ 暂停';
}

$('gameList').innerHTML = GAMES.map(replayMeta).join('');
$('gameList').addEventListener('click', (event) => {
  const item = event.target.closest('.game-item');
  if (item && item.dataset.id) replayLoad(item.dataset.id);
});
$('replayMoveList').addEventListener('click', (event) => {
  const target = event.target.closest('[data-ply]');
  if (!target) return;
  replayStop();
  replayShow(Number(target.dataset.ply));
});
$('rpFirst').addEventListener('click', () => { replayStop(); replayShow(0); });
$('rpPrev').addEventListener('click', () => replayStep(-1));
$('rpNext').addEventListener('click', () => replayStep(1));
$('rpLast').addEventListener('click', () => { replayStop(); replayShow(replayState.boards.length - 1); });
$('rpPlay').addEventListener('click', replayToggleAuto);
$('rpSpeed').addEventListener('change', () => {
  if (replayState.timer) { replayStop(); replayToggleAuto(); }
});
handlers.replay = () => { /* 排盘模式棋盘只读 */ };

// ---------------------------------------------------------------- 摆盘模式

const edit = {
  board: initialBoard(),
  tool: null, // 棋子字符或 'erase'
};

function editFenText() {
  return toFEN(edit.board, 'w');
}

function editRefresh() {
  setBoard(edit.board, {});
  $('fenBox').textContent = editFenText();
  const result = validateSetup(edit.board);
  setStatus(
    $('editStatus'),
    result.ok ? '局面合法，可点击「从此局面开始对弈」。' : `局面待修正：${result.errors[0]}${result.errors.length > 1 ? `（等 ${result.errors.length} 项）` : ''}`,
    result.ok ? 'good' : 'bad',
  );
}

function renderPalette() {
  const palette = $('palette');
  const items = [];
  for (const side of ['red', 'black']) {
    for (const [type, name] of Object.entries(PIECES[side])) {
      items.push(`<div class="piece-chip ${side === 'red' ? 'red' : 'black'}" data-piece="${side === 'red' ? type : type.toLowerCase()}">${name}</div>`);
    }
  }
  items.push('<div class="piece-chip tool" data-piece="erase">删除</div>');
  palette.innerHTML = items.join('');
  palette.addEventListener('click', (event) => {
    const chip = event.target.closest('.piece-chip');
    if (!chip) return;
    edit.tool = chip.dataset.piece;
    palette.querySelectorAll('.piece-chip').forEach((el) => {
      el.classList.toggle('selected', el === chip);
    });
  });
}

handlers.edit = (point) => {
  if (!edit.tool) { toast('请先在右侧选择一个棋子或“删除”'); return; }
  if (edit.tool === 'erase') {
    edit.board[point.r][point.c] = null;
  } else {
    edit.board[point.r][point.c] = edit.tool;
  }
  editRefresh();
};

$('edClear').addEventListener('click', () => {
  edit.board = Array.from({ length: 10 }, () => Array(9).fill(null));
  editRefresh();
});

$('edInitial').addEventListener('click', () => {
  edit.board = initialBoard();
  editRefresh();
});

$('edStart').addEventListener('click', () => {
  const result = validateSetup(edit.board);
  if (!result.ok) {
    toast(`局面非法：${result.errors[0]}`, 'bad');
    return;
  }
  play.startFen = editFenText();
  play.board = cloneBoard(edit.board);
  play.side = 'w';
  play.history = [];
  play.over = gameStatus(play.board, play.side).over;
  playRefresh();
  switchTab('play');
  toast('新对局开始（摆盘局面），红方先行', 'good');
});

$('edCopyFen').addEventListener('click', () => copyText(editFenText()));

$('edImportFen').addEventListener('click', async () => {
  const text = window.prompt('粘贴 FEN 字符串（如 rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w）：');
  if (!text) return;
  try {
    const { board } = fromFEN(text.trim());
    const result = validateSetup(board);
    edit.board = board;
    editRefresh();
    toast(result.ok ? 'FEN 已载入摆盘' : `已载入（注意：${result.errors[0]}）`, result.ok ? 'good' : 'bad');
  } catch (err) {
    toast(`FEN 解析失败：${err.message}`, 'bad');
  }
});

// ---------------------------------------------------------------- 启动

renderPalette();
editRefresh();

if (playRestore()) {
  playRefresh();
  toast('已恢复上次对局进度', 'good');
} else {
  playRefresh();
}
replayLoad(GAMES[0] && GAMES[0].id);
switchTab('play');
repaint();
