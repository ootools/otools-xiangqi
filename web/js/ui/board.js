/**
 * 棋盘 Canvas 渲染（纯绘制 + 坐标换算，不持有游戏逻辑）。
 * 红方始终在下：ICCS 行 0（红方底线）绘制在画布底部，行 9（黑方底线）在顶部；
 * 列 a（红方左手 / 红九路）在画布左侧。
 */
import { PIECES, colorOf } from '../engine/xiangqi.js';

const COLS = 9;
const ROWS = 10;
const FILE_CHARS = 'abcdefghi';

const THEME = {
  bgOuter: '#15130f',
  bgBoardTop: '#31281d',
  bgBoardBottom: '#241d14',
  line: 'rgba(216, 185, 136, 0.85)',
  lineDim: 'rgba(216, 185, 136, 0.45)',
  coord: 'rgba(216, 185, 136, 0.75)',
  riverText: 'rgba(216, 185, 136, 0.55)',
  faceTop: '#f7ecd4',
  faceBottom: '#dcc79c',
  ring: '#a8894f',
  redText: '#b83227',
  blackText: '#2f2c26',
  selectRing: '#ffd54f',
  targetDot: 'rgba(255, 213, 79, 0.95)',
  targetRing: 'rgba(255, 213, 79, 0.9)',
  lastMove: 'rgba(126, 231, 135, 0.9)',
  checkGlow: 'rgba(224, 93, 93, 0.9)',
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 画布内边距、格距与原点（随尺寸自适应）。 */
function metrics(width, height, dpr) {
  // 上下留出纵线坐标文字的空间
  const marginX = Math.max(26, width * 0.055);
  const marginY = Math.max(34, height * 0.075);
  const cell = Math.min((width - marginX * 2) / (COLS - 1), (height - marginY * 2) / (ROWS - 1));
  const boardW = cell * (COLS - 1);
  const boardH = cell * (ROWS - 1);
  const ox = (width - boardW) / 2;
  const oy = (height - boardH) / 2;
  return { marginX, marginY, cell, ox, oy, boardW, boardH };
}

/** 格点 (col a-i = 0-8, row 0-9) → 画布像素中心。行 0 绘制在底部。 */
export function cellToPixel(point, m) {
  return {
    x: m.ox + point.c * m.cell,
    y: m.oy + (ROWS - 1 - point.r) * m.cell,
  };
}

/** 画布像素 → 最近格点（超出范围返回 null）。 */
export function pixelToCell(x, y, m) {
  const c = Math.round((x - m.ox) / m.cell);
  const r = (ROWS - 1) - Math.round((y - m.oy) / m.cell);
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
  return { r, c };
}

function drawStar(ctx, x, y, cell) {
  const g = cell * 0.09;
  const L = cell * 0.22;
  const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (const [sx, sy] of corners) {
    const bx = x + sx * g;
    const by = y + sy * g;
    ctx.beginPath();
    ctx.moveTo(bx + sx * L, by);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx, by + sy * L);
    ctx.stroke();
  }
}

export function renderBoard(canvas, board, view = {}) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(120, rect.width);
  const height = Math.max(120, rect.height);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const m = metrics(width, height, dpr);
  const { cell, ox, oy, boardW, boardH } = m;

  // 底色
  const outer = ctx.createLinearGradient(0, 0, width, height);
  outer.addColorStop(0, THEME.bgOuter);
  outer.addColorStop(1, '#1a1712');
  ctx.fillStyle = outer;
  ctx.fillRect(0, 0, width, height);

  const pad = cell * 0.62;
  const wood = ctx.createLinearGradient(0, oy - pad, 0, oy + boardH + pad);
  wood.addColorStop(0, THEME.bgBoardTop);
  wood.addColorStop(0.5, '#2c2318');
  wood.addColorStop(1, THEME.bgBoardBottom);
  roundRect(ctx, ox - pad, oy - pad, boardW + pad * 2, boardH + pad * 2, cell * 0.32);
  ctx.fillStyle = wood;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 线框
  ctx.strokeStyle = THEME.line;
  ctx.lineWidth = Math.max(1, cell * 0.035);
  ctx.strokeRect(ox, oy, boardW, boardH);

  // 内部横线
  ctx.lineWidth = Math.max(0.8, cell * 0.025);
  for (let r = 1; r <= 8; r++) {
    const y = oy + (ROWS - 1 - r) * cell;
    ctx.beginPath();
    ctx.moveTo(ox, y);
    ctx.lineTo(ox + boardW, y);
    ctx.stroke();
  }

  // 竖线：河界上下分段，两侧边线贯通
  const riverTop = oy + 4 * cell;
  const riverBottom = oy + 5 * cell;
  for (let cIdx = 1; cIdx < COLS - 1; cIdx++) {
    const x = ox + cIdx * cell;
    ctx.beginPath();
    ctx.moveTo(x, oy);
    ctx.lineTo(x, riverTop);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, riverBottom);
    ctx.lineTo(x, oy + boardH);
    ctx.stroke();
  }

  // 九宫斜线
  ctx.strokeStyle = THEME.lineDim;
  const palaces = [
    { top: 7, bottom: 9 }, // 黑方九宫（画布上方）
    { top: 0, bottom: 2 }, // 红方九宫（画布下方）
  ];
  for (const p of palaces) {
    const yTop = oy + (ROWS - 1 - p.bottom) * cell;
    const yBottom = oy + (ROWS - 1 - p.top) * cell;
    const xL = ox + 3 * cell;
    const xR = ox + 5 * cell;
    ctx.beginPath();
    ctx.moveTo(xL, yTop);
    ctx.lineTo(xR, yBottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(xR, yTop);
    ctx.lineTo(xL, yBottom);
    ctx.stroke();
  }

  // 炮位/兵位标记
  const stars = [];
  for (const cIdx of [1, 7]) stars.push({ r: 2, c: cIdx }, { r: 7, c: cIdx });
  for (const cIdx of [0, 2, 4, 6, 8]) stars.push({ r: 3, c: cIdx }, { r: 6, c: cIdx });
  ctx.strokeStyle = THEME.lineDim;
  ctx.lineWidth = Math.max(0.8, cell * 0.02);
  for (const st of stars) {
    const { x, y } = cellToPixel(st, m);
    drawStar(ctx, x, y, cell);
  }

  // 楚河汉界
  ctx.fillStyle = THEME.riverText;
  ctx.font = `bold ${Math.round(cell * 0.52)}px "Kaiti SC", "STKaiti", "KaiTi", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const riverMid = (riverTop + riverBottom) / 2;
  ctx.fillText('楚 河', ox + boardW * 0.26, riverMid);
  ctx.fillText('漢 界', ox + boardW * 0.74, riverMid);

  // 纵线坐标：底部红方汉字（右起一~九），顶部黑方数字（左起 1~9）
  ctx.fillStyle = THEME.coord;
  ctx.font = `${Math.round(cell * 0.3)}px system-ui, sans-serif`;
  const redFiles = ['九', '八', '七', '六', '五', '四', '三', '二', '一']; // a..i
  for (let cIdx = 0; cIdx < COLS; cIdx++) {
    const x = ox + cIdx * cell;
    ctx.fillText(redFiles[cIdx], x, oy + boardH + cell * 0.52);
    ctx.fillText(String(cIdx + 1), x, oy - cell * 0.52);
  }

  // 选中格
  if (view.selected) {
    const { x, y } = cellToPixel(view.selected, m);
    ctx.strokeStyle = THEME.selectRing;
    ctx.lineWidth = Math.max(2, cell * 0.06);
    const half = cell * 0.52;
    ctx.strokeRect(x - half, y - half, half * 2, half * 2);
  }

  // 上一步标记（角框）
  if (view.lastMove) {
    ctx.strokeStyle = THEME.lastMove;
    ctx.lineWidth = Math.max(1.5, cell * 0.05);
    for (const point of [view.lastMove.from, view.lastMove.to]) {
      const { x, y } = cellToPixel(point, m);
      const half = cell * 0.44;
      const seg = cell * 0.18;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.beginPath();
        ctx.moveTo(x + sx * half - sx * seg, y + sy * half);
        ctx.lineTo(x + sx * half, y + sy * half);
        ctx.lineTo(x + sx * half, y + sy * half - sy * seg);
        ctx.stroke();
      }
    }
  }

  // 合法落点
  if (Array.isArray(view.targets)) {
    for (const t of view.targets) {
      const { x, y } = cellToPixel(t, m);
      if (board[t.r][t.c]) {
        ctx.strokeStyle = THEME.targetRing;
        ctx.lineWidth = Math.max(2, cell * 0.06);
        ctx.beginPath();
        ctx.arc(x, y, cell * 0.44, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = THEME.targetDot;
        ctx.beginPath();
        ctx.arc(x, y, cell * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // 棋子
  const pieces = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (p) pieces.push({ r, c, p });
    }
  }
  for (const { r, c, p } of pieces) {
    const { x, y } = cellToPixel({ r, c }, m);
    const radius = cell * 0.44;
    const isRed = colorOf(p) === 'w';
    const glow = view.checkedKing && view.checkedKing.r === r && view.checkedKing.c === c;

    if (glow) {
      ctx.fillStyle = THEME.checkGlow;
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.22, 0, Math.PI * 2);
      ctx.fill();
    }

    const grad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.35, radius * 0.2, x, y, radius);
    grad.addColorStop(0, THEME.faceTop);
    grad.addColorStop(1, THEME.faceBottom);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = Math.max(1.4, radius * 0.1);
    ctx.strokeStyle = THEME.ring;
    ctx.stroke();

    // 内圈
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.82, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, radius * 0.06);
    ctx.strokeStyle = isRed ? 'rgba(184, 50, 39, 0.75)' : 'rgba(47, 44, 38, 0.6)';
    ctx.stroke();

    ctx.fillStyle = isRed ? THEME.redText : THEME.blackText;
    ctx.font = `bold ${Math.round(radius * 1.12)}px "Kaiti SC", "STKaiti", "KaiTi", "SimKai", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(PIECES[isRed ? 'red' : 'black'][p.toUpperCase()], x, y + radius * 0.06);
  }

  return { metrics: m };
}

/** 绑定画布点击，返回换算后的格点。 */
export function onBoardClick(canvas, handler) {
  canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const dpr = window.devicePixelRatio || 1;
    const m = metrics(rect.width, rect.height, dpr);
    const point = pixelToCell(x, y, m);
    if (point) handler(point);
  });
}

/** 生成视图当前的高亮数据（供渲染）：checkedKing 由调用方计算。 */
export { FILE_CHARS };
