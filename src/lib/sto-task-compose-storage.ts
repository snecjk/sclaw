/** sessionStorage key: JSON `{ taskId, entryId, cardBase }` set before navigating to a task subitem for one-shot auto-compose. */
export const STO_TASK_PENDING_COMPOSE_KEY = 'sto-pending-compose';

/** React Router `location.state` flag: home card re-used today's subitem → scroll chat to bottom, no auto-send. */
export const STO_TASK_SUBITEM_NAV_SCROLL_END = 'stoTaskSubitemScrollEnd' as const;

export type StoTaskSubitemLocationState = {
  [STO_TASK_SUBITEM_NAV_SCROLL_END]?: boolean;
};
