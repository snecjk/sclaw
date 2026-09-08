import { useCallback, useEffect, useState } from 'react';
import { loadAuthorizedSiteMenus } from '../sclaw/site-menu';
import {
  AUTHORIZED_MENU_LOADING_STATE,
  createAuthorizedMenuErrorState,
  createAuthorizedMenuResolvedState,
  type AuthorizedMenuLoadState,
} from './authorized-menu-state';

export function useAuthorizedMenu(): AuthorizedMenuLoadState & { reload: () => void } {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<AuthorizedMenuLoadState>(AUTHORIZED_MENU_LOADING_STATE);

  useEffect(() => {
    let active = true;
    setState(AUTHORIZED_MENU_LOADING_STATE);
    void loadAuthorizedSiteMenus()
      .then((items) => {
        if (active) setState(createAuthorizedMenuResolvedState(items));
      })
      .catch((error: unknown) => {
        if (active) setState(createAuthorizedMenuErrorState(error));
      });
    return () => {
      active = false;
    };
  }, [revision]);

  const reload = useCallback(() => setRevision((current) => current + 1), []);
  return { ...state, reload };
}
