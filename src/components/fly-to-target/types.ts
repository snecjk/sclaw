/** 纯数据矩形快照（避免 live DOMRect 被浏览器改写） */
export interface FlyToTargetRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** CustomEvent.detail：飞行起点矩形 */
export interface FlyToTargetDetail {
  startRect: FlyToTargetRect;
}

/** 单颗飞球的运行时状态 */
export interface FlyBallState {
  id: number;
  startRect: FlyToTargetRect;
  endRect: FlyToTargetRect;
}
