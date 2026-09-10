import {
  createKeywordActivationMatcher,
  type SclawActivationDefinition,
} from '../../../../shared/agent-extensions';
import { isEmbedAppChatSessionKey } from '../../../../shared/session-type';

export const STO_BROWSER_BRIDGE_ACTIVATION = 'browser-bridge';

const matchesBrowserBridgeIntent = createKeywordActivationMatcher({
  keywords: [
    'bridge_',
    'browser bridge',
    'browser tool',
    '浏览器桥接',
    '浏览器工具',
    '浏览器',
    // TODO(web-bridge): 上线前不把「打开网页」当成 Web Bridge 意图。
    // '打开浏览器',
    // '打开网页',
    // '打开网站',
    '当前浏览器',
    '当前页面',
    '左侧页面',
    '左侧应用',
  ],
  patterns: [
    /(?:点击|打开|进入|填写|输入|截图|查看|操作).{0,16}(?:网页|页面|菜单|按钮|表单|浏览器|标签页)/u,
    /(?:网页|页面|菜单|按钮|表单|浏览器|标签页).{0,16}(?:点击|打开|进入|填写|输入|截图|查看|操作)/u,
  ],
  reason: 'browser-bridge-intent',
});

export const browserBridgeActivation: SclawActivationDefinition = {
  id: STO_BROWSER_BRIDGE_ACTIVATION,
  scope: 'session',
  match(context) {
    if (context.mode === 'scheduled') {
      return { active: true, reason: 'scheduled-browser-compatibility' };
    }
    if (isEmbedAppChatSessionKey(context.sessionKey)) {
      return { active: true, reason: 'embed-browser-session' };
    }
    return matchesBrowserBridgeIntent(context);
  },
};
