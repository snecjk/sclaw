/**
 * 预览区「编辑工作流」跳转接口。
 *
 * 产物预览不内嵌工作流详情；业务方接入此回调完成路由/外链跳转。
 */
export type OnEditWorkflowNavigate = (workflowId: string) => void;
