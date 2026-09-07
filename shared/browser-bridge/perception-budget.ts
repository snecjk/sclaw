/**
 * 感知预算的单一事实源（契约 3）。
 *
 * 任何返回页面观察结果的路径都必须有上限，超限必须自述 truncated。
 * AX 主路径按字符预算三轮降级；统一观测契约再按字符预算裁剪 elements；
 * embed DOM 快照按节点数截断；Chrome 扩展只收可交互节点，另有节点上限。
 *
 * 页内注入脚本不能 import 本模块，数字由测试钉死（embed 的 MAX_SNAPSHOT_NODES、
 * 扩展的 ELEMENT_LIMIT）。改这里必须同步改注入脚本。
 */

/** AX / 序列化观察的字符预算。与历史常量 BROWSER_AUTOMATION_AX_NODE_BUDGET 同值。 */
export const PERCEPTION_CHAR_BUDGET = 60_000;

/** embed `buildSnapshot` 的节点上限（含折叠后仍产出记录的节点）。 */
export const EMBED_SNAPSHOT_MAX_NODES = 600;

/** Chrome 扩展 page-agent 可交互元素上限（扁平列表，不是嵌套树）。 */
export const EXTENSION_INTERACTIVE_MAX_NODES = 400;

export const PERCEPTION_TRUNCATED_HINT =
  '观察已达预算并截断。请先滚动或收窄到目标区域再观察，不要指望一次拿到整页。';

export type PerceptionDegradationRound = 0 | 1 | 2 | 3;
