export const MAX_VISIBLE_CARDS = 3;

export interface ShelfWindow {
  readonly start: number;
  readonly indices: readonly number[];
}

/**
 * 系列卡组窗口：最多同时挂载 3 张。
 * n <= 3 全部显示；否则以当前款式为中心，边界处收敛。
 */
export function visibleWindow(count: number, activeIndex: number, maxVisible = MAX_VISIBLE_CARDS): ShelfWindow {
  if (count <= 0) return { start: 0, indices: [] };
  if (count <= maxVisible) {
    return { start: 0, indices: Array.from({ length: count }, (_, index) => index) };
  }
  const clampedActive = Math.min(Math.max(activeIndex, 0), count - 1);
  const start = Math.min(Math.max(clampedActive - 1, 0), count - maxVisible);
  return {
    start,
    indices: Array.from({ length: maxVisible }, (_, offset) => start + offset),
  };
}
