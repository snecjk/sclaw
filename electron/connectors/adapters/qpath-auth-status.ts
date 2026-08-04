/**
 * QPath CLI auth / login output parsers (pure — safe for unit tests).
 */
import {
  extractSkillRevisionFromFilename,
  shouldUpdateSkillRevision,
} from '../../../shared/connectors/skill-revision';

const LOGIN_URL_RE = /https:\/\/login\.dingtalk\.com\/oauth2\/auth\?[^\s\])"'<>]+/i;

export function extractQpathLoginUrl(output: string): string | null {
  const match = output.match(LOGIN_URL_RE);
  if (!match?.[0]) return null;
  return match[0].replace(/[.,;:]+$/, '').trim();
}

/** Parse `qpath status` human text for logged-in flag. */
export function parseQpathStatusLoggedIn(statusText: string): boolean {
  const text = statusText.trim();
  if (!text) return false;
  if (/登录状态\s*[:：]\s*已登录/.test(text)) return true;
  if (/login\s*status\s*[:：]\s*logged\s*in/i.test(text)) return true;
  if (/未登录|not\s*logged\s*in/i.test(text)) return false;
  return false;
}

/** Detect auth-expired / not-logged-in errors from qpath stderr/stdout. */
export function isQpathAuthExpiredMessage(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return (
    /未登录/.test(text)
    || /请先运行\s*qpath\s*login/i.test(text)
    || /not\s*logged\s*in/i.test(text)
    || /please\s+run\s+qpath\s+login/i.test(text)
    || /登录过期|token.*expir|unauthorized|401/i.test(text)
  );
}

/** @deprecated use shouldUpdateSkillRevision */
export const shouldUpdateQpathSkill = shouldUpdateSkillRevision;

/** @deprecated use extractSkillRevisionFromFilename */
export const extractQpathSkillRevisionFromFilename = extractSkillRevisionFromFilename;
