import workflowPageShadingImg from '@/assets/workflow-page-shading.png';
import {
  workflowPageShadingLayerClass,
  workflowPageShadingPatternClass,
} from '@/lib/surfaces';

/**
 * 工作流列表页底纹夹层：铺在页面灰底之上、业务内容之下；不参与文档流。
 * backgroundImage 走 inline style：Vite 资源 URL 无法写进 Tailwind 任意类名。
 */
export function WorkflowPageShading() {
  return (
    <div className={workflowPageShadingLayerClass} aria-hidden>
      <div
        className={workflowPageShadingPatternClass}
        style={{ backgroundImage: `url(${workflowPageShadingImg})` }}
      />
    </div>
  );
}
