/**
 * App icons — aligned with more-apps-icons.js (linear SVG style)
 * Returns SVG markup strings for use with dangerouslySetInnerHTML or as React nodes.
 */

const SVG_ATTRS =
  'viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

function icon(paths: string): string {
  return `<svg ${SVG_ATTRS}>${paths}</svg>`;
}

export const APP_ICONS: Record<string, string> = {
  'org-relation': icon(
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  ),
  'customer-quote': icon(
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h2"/><path d="M8 17h8"/><path d="M12 13h4"/><path d="M16 17h0"/>',
  ),
  'customer-freight': icon(
    '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8"/><path d="M8 10h2"/><path d="M12 10h2"/><path d="M16 10h0"/><path d="M8 14h2"/><path d="M12 14h2"/><path d="M16 14h0"/><path d="M8 18h2"/><path d="M12 18h6"/>',
  ),
  'cost-mgmt': icon(
    '<path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-6"/>',
  ),
  'report-maker': icon(
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  ),
  'api-transfer': icon(
    '<path d="M7 7h10"/><path d="M7 17h10"/><path d="M17 7l3 3-3 3"/><path d="M7 17l-3-3 3-3"/><rect x="2" y="5" width="6" height="14" rx="1"/><rect x="16" y="5" width="6" height="14" rx="1"/>',
  ),
  'outlet-shared-files': icon(
    '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/><path d="M12 10v6"/><path d="M9 13h6"/>',
  ),
  'fund-ledger': icon(
    '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-4h6v4"/>',
  ),
  attendance: icon(
    '<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/><path d="M9 16l2 2 4-4"/>',
  ),
  'contract-archive': icon(
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  ),
  'material-stock': icon(
    '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05"/><path d="M12 22.08V12"/>',
  ),
  'vehicle-dispatch': icon(
    '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  ),
  external: icon(
    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
  ),
  default: icon(
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  ),
};

export function getAppIcon(key?: string): string {
  if (!key) return APP_ICONS.default;
  return APP_ICONS[key] ?? APP_ICONS.default;
}
