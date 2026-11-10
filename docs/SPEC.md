# otools-xiangqi 实现规格（中国象棋）

OTools 独立插件：中国象棋——双人对弈 + 名局棋谱排盘 + 自由摆盘，内置完整规则引擎。
纯静态实现（原生 HTML/CSS/JS ES modules，无 npm/打包器）。

## plugin.json

```json
{
  "uuid": "otools-xiangqi", "packid": "otools-xiangqi",
  "displayName": "Xiangqi", "displayNameCN": "中国象棋",
  "developerName": "OTools", "summary": "双人对弈 + 名局棋谱排盘 + 自由摆盘，内置完整规则引擎的桌面象棋。",
  "version": "0.1.0", "entry": "dist/index.html",
  "devUrl": "http://127.0.0.1:6541", "quickDev": true, "hasAd": false,
  "inPluginPurchase": false, "openInBrowser": false,
  "logo": "logo.svg", "icon": "♟️", "screenshots": [],
  "key": ["象棋", "棋谱", "排盘", "对弈", "xiangqi", "chinese chess"]
}
```

## 目录与公共约定

- `web/index.html`：入口。**必须保留模板里的 OTools 宿主桥脚本**（`window.otoolsPlugin`，用于导入/导出棋谱文件；内容含 "otools" 字样，verify-plugin 依赖）。深色主题（底色 #1b1d22 系）。
- `web/js/engine/xiangqi.js`（可拆多文件）：**纯函数、无 DOM 依赖**，node --test 可直接 import。
- `web/js/ui/`：界面逻辑；`web/data/`：内置棋谱；`tests/`（仓库根，不进 dist）：`node --test tests/` 全绿。
- `node scripts/build-web.mjs` 拷贝 web/ → dist/；dist 为构建产物，按模板惯例 gitignore 不入库（CI 出 artifact）。沿用模板 `.gitignore`。
- 棋盘 canvas 绘制（或 DOM grid），窗口缩放自适应，红方在下。

## 引擎规则（必须完整实现并测试）

- 棋盘 9 列 × 10 行；棋子 R车 N马 B相/象 A士 K帅/将 C炮 P兵/卒，红大写黑小写；红在下（河界界于行 4/5）。
- 车直线；马日字且**蹩马腿**；相/象田字且**塞象眼**且不过河；士/仕九宫斜行一格；帅/将九宫内直行一格且**双王不同列照面**（照面局面非法）；炮直行、隔一子吃；兵/卒过河前只进一格、过河后可进可平。
- 走子后己方不能被将军（送将非法）；被将军必须应将；无合法着法 → **困毙判负**（含将死）。
- 将军/将死检测；重复局面（含行棋方）第三次出现给出提示（简化处理，不自动判负，README 注明长将/长捉未实现）。
- 中文纵线记谱：红方汉字一~九（从红方右侧起数），黑方数字 1~9（从黑方右侧即红方左侧起数）；进/退/平；同列同种双子用 前/后 区分（兵三子以上用 前/中/后 简化即可）。
- FEN 序列化（标准 Xiangqi FEN：如 `rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w`）导入导出。
- API 建议形如：`initialBoard() / legalMoves(board, side) / makeMove / isCheck / isCheckmate / toChineseNotation / toFEN / fromFEN`。

## 名局棋谱库（核心卖点）

- `web/data/games/`（JS module 导出）：≥8 局，结构 `{id,title,event,date,red,black,result,moves:[{iccs,comment?}],source}`，着法用 ICCS（如 `H2-E2`）。
- 选目原则：**只收把握度高的局**——杀法名局（如七步杀、马后炮、双车错等典型杀法演示局）、《橘中秘》《梅花谱》典型全局、近代有公开记录的经典对局；宁可少而准。
- `tests/games.test.js`：**每一局逐步走子校验合法性**（任何非法步 = 测试失败），并抽查记谱生成。不合法的步必须修正或删局。
- 每局 `source` 注明出处；README 列出收录清单。

## UI（左侧棋盘 + 右侧面板，三个 tab）

- **对弈**：点击选子 → 高亮所有合法落点 → 点击走子；悔棋；重新开始；将军/将死/困毙提示；记谱列表随对局滚动。
- **排盘**：名局列表 → 载入；控制条 首/上一/下一/末/自动播放（速度可选）；点击任一着法跳转；最后一步高亮、将军提示；当前步注解显示在面板。
- **摆盘**：棋子选择盘（车马相士帅炮兵 × 红黑 + 删除）→ 点击棋盘放置/替换；清空、初始局面按钮；「从此局面开始对弈」（校验：双方有王、王在九宫、无其他非法位置，兵不落后场等基本项）；当前局面 FEN 显示与复制。
- 导入/导出：FEN、对局 JSON（宿主桥 openText/saveText；浏览器退化为 input[type=file] / 下载）。
- 对局进度 localStorage 保存，重开页面可恢复。

## 测试清单（node --test）

1. 规则单元：蹩马腿、塞象眼、照面、过河兵、炮打隔子、送将禁手、将死样本（如闷宫）。
2. 内置棋谱逐步合法 + 覆盖每局元数据完整。
3. 记谱：初始局面常见着法（炮二平五 H2-E2、马八进七 B0-C2 等）抽查。
4. FEN 往返一致。
