export function isGlobalToastInteractionTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.sto-global-toaster') !== null;
}
