/** Module-level navigate binder so non-React modules can change routes. */
type AppNavigateFn = (to: string) => void;

let navigateFn: AppNavigateFn | null = null;

export function bindAppNavigate(fn: AppNavigateFn): void {
  navigateFn = fn;
}

export function unbindAppNavigate(fn: AppNavigateFn): void {
  if (navigateFn === fn) navigateFn = null;
}

export function appNavigate(to: string): void {
  navigateFn?.(to);
}
