import { cn } from '@/lib/utils';

export const dataCenterToolbarSurfaceClass = cn(
  'sto-control sto-control--outline sto-control--neutral-outline-default',
  'h-[34px] rounded-[10px] border',
);

export const dataCenterToolbarInteractiveSurfaceClass = cn(
  dataCenterToolbarSurfaceClass,
  'sto-control--data-center-toolbar-interactive transition-colors duration-150',
);

export const dataCenterToolbarButtonClass = cn(
  dataCenterToolbarInteractiveSurfaceClass,
  'px-3 text-[13px] font-medium',
);
