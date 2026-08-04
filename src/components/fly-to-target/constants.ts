/** 飞入目标请求的 Window CustomEvent 名称 */
export const FLY_TO_TARGET_EVENT = 'stoclaw:fly-to-target';

/** 同时飞行的图标上限（对象池大小） */
export const FLY_TO_TARGET_MAX_BALLS = 5;

/** 抛物线飞行时长（毫秒） */
export const FLY_TO_TARGET_DURATION_MS = 620;

/**
 * 纵向缓动：中间控制点为负，形成抛物线落感
 * （与经典购物车「掉球」轨迹同款曲线）
 */
export const FLY_TO_TARGET_Y_EASING = 'cubic-bezier(0.49, -0.29, 0.75, 0.41)';

/** 横向缓动：线性，与 Y 轴合成弧线 */
export const FLY_TO_TARGET_X_EASING = 'linear';

/** 飞行过程中的缩放缓动（起点尺寸 → 终点尺寸） */
export const FLY_TO_TARGET_SCALE_EASING = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

/** 飞球默认视觉尺寸 */
export const FLY_TO_TARGET_DEFAULT_SIZE = 14;

/** 起点元素点击反馈：放大倍数与时长 */
export const FLY_TO_TARGET_START_POP_SCALE = 1.2;
export const FLY_TO_TARGET_START_POP_MS = 160;

/** 抵达后目标弹一下：先放大到 1.1 再回弹到 1 */
export const FLY_TO_TARGET_ARRIVE_POP_SCALE = 1.1;
export const FLY_TO_TARGET_ARRIVE_UP_MS = 140;
export const FLY_TO_TARGET_ARRIVE_DOWN_MS = 220;
