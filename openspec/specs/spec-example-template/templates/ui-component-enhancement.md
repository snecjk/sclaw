# Template: UI Component Enhancement

Use this template when adding or modifying a React component that does NOT require main-process communication.

---

## 1. Component Implementation

Create or update the component under `src/components/`.

```tsx
// src/components/ui/new-component.tsx
import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';

export interface NewComponentProps {
  title: string;
  description?: string;
  onAction?: (value: string) => void;
  className?: string;
}

export function NewComponent({
  title,
  description,
  onAction,
  className,
}: NewComponentProps) {
  const [value, setValue] = useState('');

  const handleClick = useCallback(() => {
    onAction?.(value);
  }, [onAction, value]);

  return (
    <div className={cn('rounded-lg border p-4', className)}>
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="mt-2 w-full rounded border px-2 py-1"
      />
      <button
        onClick={handleClick}
        className="mt-2 rounded bg-primary px-4 py-2 text-primary-foreground"
      >
        Action
      </button>
    </div>
  );
}
```

## 2. Custom Hook (if needed)

If the component requires reusable logic, extract it into a custom hook.

```ts
// src/hooks/use-new-component.ts
import { useState, useCallback } from 'react';

export function useNewComponent(initialValue = '') {
  const [value, setValue] = useState(initialValue);
  const [isLoading, setIsLoading] = useState(false);

  const performAction = useCallback(async (actionValue: string) => {
    setIsLoading(true);
    try {
      // Component-level logic only
      // If you need to call backend APIs, use host-api through the component props
      // or accept an async callback from the parent
      const result = await someLocalLogic(actionValue);
      return result;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { value, setValue, isLoading, performAction };
}
```

> **⚠️ NOTE**: UI components and hooks should NOT directly call `window.electron` APIs.
> Backend communication MUST be delegated to the host-api layer via props or context.

## 3. Storybook / Documentation (if applicable)

```tsx
// Example usage in a story or documentation
import { NewComponent } from '@/components/ui/new-component';

export default {
  title: 'UI/NewComponent',
  component: NewComponent,
};

export const Default = () => (
  <NewComponent
    title="Sample Title"
    description="This is a sample description"
    onAction={(value) => console.log(value)}
  />
);
```

## 4. Unit Tests

```ts
// tests/unit/components/new-component.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NewComponent } from '@/components/ui/new-component';

describe('NewComponent', () => {
  it('renders title and description', () => {
    render(
      <NewComponent
        title="Test Title"
        description="Test Description"
      />
    );
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Test Description')).toBeInTheDocument();
  });

  it('calls onAction with input value', () => {
    const onAction = vi.fn();
    render(<NewComponent title="Test" onAction={onAction} />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'test-value' } });

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(onAction).toHaveBeenCalledWith('test-value');
  });
});
```

## 5. Export Registration

Ensure the component is exported from the appropriate index file.

```ts
// src/components/ui/index.ts
export { NewComponent } from './new-component';
export type { NewComponentProps } from './new-component';
```

---

## Build & Test Checklist

- [ ] Run `pnpm run lint` and fix any issues
- [ ] Run `pnpm run typecheck` and fix any type errors
- [ ] Add/update unit tests for the component and hook
- [ ] Verify the component renders correctly in the target page
- [ ] Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` for required updates (if component is user-facing)
