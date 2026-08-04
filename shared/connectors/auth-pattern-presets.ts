/**
 * Shared DingTalk / CLI auth URL patterns for Admin templates & defaults.
 * Prefer copying into server connector auth; client happy-path must not hardcode.
 */
export const DINGTALK_LOGIN_URL_PATTERNS = [
  String.raw`https://login\.dingtalk\.com/oauth2/auth\?[^\s\])"'<>]+`,
  String.raw`https://login\.dingtalk\.com/oauth2/device/verify\.htm\?user_code=\S+`,
];

export const QPATH_AUTH_PATTERNS = {
  loginUrlPattern: DINGTALK_LOGIN_URL_PATTERNS[0],
  loggedInPattern: String.raw`登录状态\s*[:：]\s*已登录|login\s*status\s*[:：]\s*logged\s*in`,
  loggedOutPattern: String.raw`未登录|not\s*logged\s*in`,
  authExpiredPattern: String.raw`未登录|请先运行\s*qpath\s*login|not\s*logged\s*in|please\s+run\s+qpath\s+login|登录过期|token.*expir|unauthorized|401`,
};

export const DWS_AUTH_PATTERNS = {
  loginUrlPattern: DINGTALK_LOGIN_URL_PATTERNS,
  loggedInPattern: undefined as string | undefined,
  loggedOutPattern: undefined as string | undefined,
  authExpiredPattern: String.raw`未登录|login\s*required|unauthorized|401|token.*expir`,
};
