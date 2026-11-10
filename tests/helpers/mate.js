/**
 * 杀局搜索辅助（仅测试用）：判定攻击方能否在给定半着数内
 * 将死或困毙防守方（黑方每个应着都必须被后续杀法覆盖）。
 */
import { legalMoves, applyMove, gameStatus, opponentOf } from '../../web/js/engine/xiangqi.js';

/** 攻击方（attacker）行棋，能否在 plies 半着内终局（将死/困毙）防守方。 */
export function canMate(board, attacker, plies) {
  if (plies <= 0) return false;
  const defender = opponentOf(attacker);
  for (const mv of legalMoves(board, attacker)) {
    const next = applyMove(board, mv);
    const st = gameStatus(next, defender);
    if (st.over) return true;
    if (plies >= 3) {
      const replies = legalMoves(next, defender);
      if (replies.length > 0 && replies.every((rp) => canMate(applyMove(next, rp), attacker, plies - 2))) {
        return true;
      }
    }
  }
  return false;
}

/** ICCS 坐标展示（测试失败信息用）。 */
export function iccsOf(move) {
  const files = 'abcdefghi';
  return `${files[move.from.c].toUpperCase()}${move.from.r}-${files[move.to.c].toUpperCase()}${move.to.r}`;
}
