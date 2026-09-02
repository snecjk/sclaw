import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppDevPageTypeBadge } from '../../src/components/app-dev/AppDevPageTypeBadge';

describe('app development workbench page type identity', () => {
  it.each([
    ['assets', 'Assets'],
    ['site', 'Site'],
  ] as const)('shows %s applications as %s', (pageType, label) => {
    render(<AppDevPageTypeBadge pageType={pageType} />);
    expect(screen.getByLabelText(`应用类型：${label}`)).toBeInTheDocument();
    expect(screen.queryByText(label)).not.toBeInTheDocument();
  });

  it('omits the badge until the matching catalog summary loads', () => {
    const { container } = render(<AppDevPageTypeBadge />);
    expect(container).toBeEmptyDOMElement();
  });
});
