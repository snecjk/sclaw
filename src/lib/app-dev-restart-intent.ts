const RESTART_PREVIEW_INTENT =
  /^(?:请|请帮我|帮我|麻烦|麻烦帮我)?(?:重新启动|重启)(?:一下)?(?:应用|预览|应用预览|预览服务|开发服务)?[。！!？?]?$/;

/**
 * Only intercept standalone restart commands. Longer development requests that
 * merely mention restarting must still be sent to the project agent.
 */
export function isAppDevRestartIntent(text: string): boolean {
  return RESTART_PREVIEW_INTENT.test(text.trim().replace(/\s+/g, ''));
}
