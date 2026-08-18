import { resolveAuthModeFromState } from '../../../../../shared/auth-mode-utils';
import { getAuthState, getImpersonationOrigin, getStoToken } from '../../../../utils/auth-store';
import type { BridgeHandlerFn } from './types';

export const handleAuthGetUser: BridgeHandlerFn = async () => {
  const state = await getAuthState();
  if (!state.isAuthenticated || !state.user) {
    throw Object.assign(new Error('Authentication required'), { code: 'AUTH_REQUIRED' });
  }
  const user = state.user;
  return {
    userId: user.id,
    userName: user.userName,
    realName: user.realName,
    empCode: user.empCode,
    companyCode: user.companyCode,
    companyName: user.companyName,
    departmentCode: user.departmentCode,
    departmentName: user.departmentName,
    categoryCode: user.categoryCode,
    isAdministrator: user.isAdministrator,
  };
};

export const handleAuthGetAuthMode: BridgeHandlerFn = async () => {
  const state = await getAuthState();
  const impersonationOrigin = await getImpersonationOrigin();
  return {
    loggedIn: state.isAuthenticated,
    authMode: resolveAuthModeFromState(state.user, impersonationOrigin),
    ssoEnvironment: state.ssoEnvironment,
  };
};

export const handleAuthGetToken: BridgeHandlerFn = async () => {
  const state = await getAuthState();
  if (!state.isAuthenticated || !state.user) {
    throw Object.assign(new Error('Authentication required'), { code: 'AUTH_REQUIRED' });
  }
  const token = await getStoToken();
  if (!token) {
    throw Object.assign(new Error('Token unavailable'), { code: 'AUTH_REQUIRED' });
  }
  return { token };
};

export const handleAuthRequestLogin: BridgeHandlerFn = async () => {
  throw Object.assign(new Error('Login must be initiated from SClaw host UI'), {
    code: 'PERMISSION_DENIED',
  });
};
