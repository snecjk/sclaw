/**
 * Sidebar layout variant (e.g. 省区版本) — visibility is driven here so future
 * role-based rules can be merged into {@link getSidebarVisibility} without rewiring UI.
 */
export type SidebarLayoutVariant = 'full' | 'provincial';

export type SidebarModuleKey =
  | 'primaryChat'
  | 'primaryMyData'
  | 'workspace'
  | 'conversationChrome'
  | 'userProfileCard';

export type SidebarVisibility = Record<SidebarModuleKey, boolean>;

const PROVINCIAL_VISIBILITY: SidebarVisibility = {
  primaryChat: false,
  primaryMyData: false,
  workspace: false,
  conversationChrome: false,
  /** Bottom identity strip (name / org + settings) stays on for SSO users; nav modules above stay minimal. */
  userProfileCard: true,
};

const FULL_VISIBILITY: SidebarVisibility = {
  primaryChat: true,
  primaryMyData: true,
  workspace: true,
  conversationChrome: true,
  userProfileCard: true,
};

/**
 * Defaults to provincial (省区) sidebar; set `VITE_STOCLAW_SIDEBAR_LAYOUT=full` for the
 * complete navigation rail. Later may incorporate auth role from {@link useAuthStore}.
 */
export function getSidebarLayoutVariant(): SidebarLayoutVariant {
  const raw = import.meta.env.VITE_STOCLAW_SIDEBAR_LAYOUT?.trim().toLowerCase();
  if (raw === 'full') return 'full';
  return 'provincial';
}

export function getSidebarVisibility(variant: SidebarLayoutVariant): SidebarVisibility {
  if (variant === 'provincial') return { ...PROVINCIAL_VISIBILITY };
  return { ...FULL_VISIBILITY };
}
