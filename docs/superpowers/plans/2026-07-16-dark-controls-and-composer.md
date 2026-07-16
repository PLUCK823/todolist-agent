# Dark Controls and Compact Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the dark quick-question dialog, implement the approved two-line expandable Assistant composer, and replace the native task sort select with the shared Popover visual pattern.

**Architecture:** Keep the existing page and session boundaries. Theme corrections stay in semantic CSS tokens, textarea sizing lives in a focused Agent hook, and all three task filter menus remain coordinated by `TaskFilters`. Each behavior is locked by a failing regression test before production code changes.

**Tech Stack:** React 19, TypeScript 6, Tailwind CSS 4, Vitest, Testing Library, Playwright, Docker Compose.

---

## File map

- Modify `frontend/src/styles/global.css`: theme-aware command palette and compact composer dimensions.
- Modify `frontend/src/features/agent/CommandPalette.tsx`: expose a stable themed surface contract only where needed by tests.
- Modify `frontend/src/features/agent/__tests__/CommandPalette.test.tsx`: dark-surface regression coverage.
- Modify `frontend/src/shared/ui/__tests__/theme-surfaces.test.ts`: reject hard-coded white command surfaces.
- Create `frontend/src/features/agent/useExpandableTextarea.ts`: content growth, manual resize floor, overflow, and reset behavior.
- Create `frontend/src/features/agent/__tests__/useExpandableTextarea.test.tsx`: focused hook behavior tests.
- Modify `frontend/src/pages/AssistantPage.tsx`: use the sizing hook and reset it after successful submission.
- Modify `frontend/src/pages/__tests__/AssistantPage.test.tsx`: approved B-density integration contract.
- Modify `frontend/src/features/todos/TaskFilters.tsx`: replace native sorting with the shared trigger-and-Popover pattern.
- Modify `frontend/src/features/todos/__tests__/TaskFilters.test.tsx`: sort menu selection, mutual exclusion, and focus restoration.
- Rebuild only the frontend image after all frontend gates pass; the other service images remain unchanged.

### Task 1: Theme-aware quick-question dialog

**Files:**
- Modify: `frontend/src/features/agent/__tests__/CommandPalette.test.tsx`
- Modify: `frontend/src/shared/ui/__tests__/theme-surfaces.test.ts`
- Modify: `frontend/src/styles/global.css`

- [ ] **Step 1: Write failing theme regression tests**

Add the command palette stylesheet contract to `theme-surfaces.test.ts`:

```ts
it('uses semantic theme surfaces for the quick-question dialog', () => {
  expect(globalStyles).toMatch(
    /\.command-palette\s*\{[\s\S]*?background:\s*var\(--surface\)/,
  )
  expect(globalStyles).toMatch(
    /\.command-palette textarea\s*\{[\s\S]*?background:\s*var\(--control-bg\)/,
  )
  const paletteBlock = globalStyles.match(/\.command-palette\s*\{([\s\S]*?)\}/)?.[1]
  expect(paletteBlock).not.toMatch(/rgb\(255\s+255\s+255/)
})
```

Extend the existing dialog-size test in `CommandPalette.test.tsx` to assert the semantic class remains present:

```ts
expect(screen.getByRole('dialog', { name: '快速询问' })).toHaveClass(
  'command-palette',
  'max-w-[630px]',
  'rounded-[var(--radius-dialog)]',
)
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
cd frontend
corepack pnpm vitest run \
  src/features/agent/__tests__/CommandPalette.test.tsx \
  src/shared/ui/__tests__/theme-surfaces.test.ts
```

Expected: the semantic surface test fails because `.command-palette` contains a hard-coded white background and outline.

- [ ] **Step 3: Implement the theme-token surface**

Change the command palette CSS to:

```css
.command-palette {
  width: min(630px, 100%);
  max-width: 630px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-dialog);
  padding: 8px;
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-overlay);
  animation: panel-enter 280ms cubic-bezier(.2, 0, 0, 1) both;
}

.command-palette textarea {
  /* preserve existing dimensions and typography */
  background: var(--control-bg);
  color: var(--text);
  box-shadow: inset 0 0 0 1px var(--border);
}
```

Keep the existing theme-aware header/footer borders inherited from `Dialog`. Do not introduce a dark-mode selector or fixed dark color.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Task 1 command. Expected: all selected tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add frontend/src/styles/global.css \
  frontend/src/features/agent/__tests__/CommandPalette.test.tsx \
  frontend/src/shared/ui/__tests__/theme-surfaces.test.ts
git commit -m "fix(frontend): theme quick question dialog surfaces"
```

### Task 2: Approved B-density expandable Assistant composer

**Files:**
- Create: `frontend/src/features/agent/useExpandableTextarea.ts`
- Create: `frontend/src/features/agent/__tests__/useExpandableTextarea.test.tsx`
- Modify: `frontend/src/pages/AssistantPage.tsx`
- Modify: `frontend/src/pages/__tests__/AssistantPage.test.tsx`
- Modify: `frontend/src/styles/global.css`

- [ ] **Step 1: Write failing hook and page tests**

Create a small harness in `useExpandableTextarea.test.tsx` and assert these public results:

```tsx
function Harness() {
  const [value, setValue] = useState('')
  const sizing = useExpandableTextarea(value)
  return <>
    <textarea
      ref={sizing.ref}
      aria-label="sized"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onPointerDown={sizing.onPointerDown}
      onPointerUp={sizing.onPointerUp}
    />
    <button onClick={sizing.reset}>reset</button>
  </>
}

it('clamps automatic growth and enables overflow at the automatic limit', async () => {
  render(<Harness />)
  const textarea = screen.getByRole('textbox', { name: 'sized' })
  Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 280 })
  fireEvent.change(textarea, { target: { value: 'long content' } })
  expect(textarea.style.height).toBe('220px')
  expect(textarea.style.overflowY).toBe('auto')
})

it('resets a manually enlarged draft to the two-line default', () => {
  render(<Harness />)
  const textarea = screen.getByRole('textbox', { name: 'sized' })
  textarea.style.height = '320px'
  Object.defineProperty(textarea, 'offsetHeight', { configurable: true, value: 320 })
  fireEvent.pointerDown(textarea)
  fireEvent.pointerUp(textarea)
  fireEvent.click(screen.getByRole('button', { name: 'reset' }))
  expect(textarea.style.height).toBe('56px')
})
```

In `AssistantPage.test.tsx`, strengthen the input test:

```ts
const input = screen.getByRole('textbox', { name: '智能助手消息' })
expect(input).toHaveAttribute('rows', '2')
expect(input).toHaveClass('assistant-composer__input')
```

Add a successful-send reset assertion by setting `input.style.height = '240px'`, submitting, and expecting `56px`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
cd frontend
corepack pnpm vitest run \
  src/features/agent/__tests__/useExpandableTextarea.test.tsx \
  src/pages/__tests__/AssistantPage.test.tsx
```

Expected: collection fails because `useExpandableTextarea` does not exist, and the page still renders four rows without the sizing class.

- [ ] **Step 3: Implement the sizing hook**

Create `useExpandableTextarea.ts` with this contract:

```ts
import { useCallback, useLayoutEffect, useRef } from 'react'

export const COMPOSER_DEFAULT_HEIGHT = 56
export const COMPOSER_AUTO_MAX_HEIGHT = 220

export function useExpandableTextarea(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const manualHeight = useRef<number | null>(null)
  const pointerStartHeight = useRef<number | null>(null)

  const sizeToContent = useCallback(() => {
    const element = ref.current
    if (!element) return
    element.style.height = 'auto'
    const automatic = Math.min(
      Math.max(element.scrollHeight, COMPOSER_DEFAULT_HEIGHT),
      COMPOSER_AUTO_MAX_HEIGHT,
    )
    const height = Math.max(automatic, manualHeight.current ?? 0)
    element.style.height = `${height}px`
    element.style.overflowY = element.scrollHeight > height ? 'auto' : 'hidden'
  }, [])

  useLayoutEffect(sizeToContent, [sizeToContent, value])

  const reset = useCallback(() => {
    manualHeight.current = null
    const element = ref.current
    if (!element) return
    element.style.height = `${COMPOSER_DEFAULT_HEIGHT}px`
    element.style.overflowY = 'hidden'
  }, [])

  return {
    ref,
    reset,
    onPointerDown: () => {
      pointerStartHeight.current = ref.current?.offsetHeight ?? null
    },
    onPointerUp: () => {
      const element = ref.current
      if (!element || pointerStartHeight.current === null) return
      if (element.offsetHeight !== pointerStartHeight.current) {
        manualHeight.current = Math.max(COMPOSER_DEFAULT_HEIGHT, element.offsetHeight)
      }
      pointerStartHeight.current = null
      element.style.overflowY = element.scrollHeight > element.offsetHeight ? 'auto' : 'hidden'
    },
  }
}
```

The CSS maximum height, not the hook, constrains manual resizing to 360 px.

- [ ] **Step 4: Integrate it into `AssistantPage`**

Use the hook next to `draft`:

```ts
const composer = useExpandableTextarea(draft)
```

Reset only after a successful send:

```ts
if (session.send(message)) {
  setDraft('')
  composer.reset()
}
```

Render the textarea with:

```tsx
<textarea
  ref={composer.ref}
  className="assistant-composer__input"
  aria-label="智能助手消息"
  value={draft}
  onChange={(event) => setDraft(event.target.value)}
  onPointerDown={composer.onPointerDown}
  onPointerUp={composer.onPointerUp}
  placeholder="告诉智能助手你想完成什么…"
  rows={2}
  disabled={!session.canSend}
/>
```

- [ ] **Step 5: Implement the approved compact CSS**

Use these limits:

```css
.assistant-composer {
  width: min(720px, 100%);
  margin: 0 auto;
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 8px;
  background: var(--surface);
  box-shadow: 0 14px 38px rgb(32 37 56 / 9%);
}

.assistant-composer__input {
  display: block;
  width: 100%;
  min-height: 56px;
  max-height: 360px;
  resize: vertical;
  overflow-y: hidden;
  border: 0;
  border-radius: 12px;
  padding: 10px 12px;
  background: var(--control-bg);
  color: var(--text);
  font-size: .85rem;
  line-height: 1.5;
}

.assistant-composer footer {
  min-height: 34px;
  padding: 5px 4px 0;
}
```

Keep the existing visible focus ring and disabled treatment.

- [ ] **Step 6: Run tests and verify GREEN**

Run the Task 2 command. Expected: all selected tests pass.

- [ ] **Step 7: Commit Task 2**

```bash
git add frontend/src/features/agent/useExpandableTextarea.ts \
  frontend/src/features/agent/__tests__/useExpandableTextarea.test.tsx \
  frontend/src/pages/AssistantPage.tsx \
  frontend/src/pages/__tests__/AssistantPage.test.tsx \
  frontend/src/styles/global.css
git commit -m "fix(frontend): add compact expandable assistant composer"
```

### Task 3: Unified task sorting Popover

**Files:**
- Modify: `frontend/src/features/todos/TaskFilters.tsx`
- Modify: `frontend/src/features/todos/__tests__/TaskFilters.test.tsx`

- [ ] **Step 1: Replace native-select expectations with failing Popover tests**

Change the accessible sorting test to:

```ts
await user.click(screen.getByRole('button', { name: '任务排序：最近创建' }))
const menu = screen.getByRole('dialog', { name: '任务排序' })
await user.click(within(menu).getByRole('button', { name: '截止时间' }))
expect(onChange).toHaveBeenLastCalledWith(
  expect.objectContaining({ sort_by: 'due_date', order: 'asc', page: 1 }),
)
expect(screen.queryByRole('combobox', { name: '任务排序' })).not.toBeInTheDocument()
```

Update the four mapping cases to open the sorting trigger and click the matching option label. Add:

```ts
it('closes sorting when another filter opens', async () => {
  const user = userEvent.setup()
  render(<TaskFilters filters={{}} onChange={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: '任务排序：最近创建' }))
  await user.click(screen.getByRole('button', { name: '全部状态' }))
  expect(screen.queryByRole('dialog', { name: '任务排序' })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
cd frontend
corepack pnpm vitest run src/features/todos/__tests__/TaskFilters.test.tsx
```

Expected: tests fail because sorting is still a native combobox.

- [ ] **Step 3: Implement the unified trigger and Popover**

In `TaskFilters.tsx`:

```ts
const [open, setOpen] = useState<'status' | 'priority' | 'sort' | null>(null)
const sortRef = useRef<HTMLButtonElement>(null)
const triggerClass = 'inline-flex min-h-10 items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--control-bg)] px-3 text-sm font-semibold text-[var(--text-secondary)] hover:border-[var(--border-strong)] focus:outline-none focus-visible:shadow-[var(--focus-ring)]'
const sortValue = `${filters.sort_by ?? 'created_at'}:${filters.order ?? 'desc'}`
const sortOptions = [
  { value: 'created_at:desc', label: '最近创建' },
  { value: 'due_date:asc', label: '截止时间' },
  { value: 'priority:desc', label: '优先级从高到低' },
  { value: 'priority:asc', label: '优先级从低到高' },
] as const
const sortLabel = sortOptions.find((option) => option.value === sortValue)?.label ?? '最近创建'
```

Use `triggerClass` for status, priority, and sorting. Replace the `select` with:

```tsx
<div>
  <button
    ref={sortRef}
    type="button"
    aria-label={`任务排序：${sortLabel}`}
    onClick={() => setOpen(open === 'sort' ? null : 'sort')}
    className={`${triggerClass} min-w-[9.75rem]`}
  >
    {sortLabel}<span aria-hidden="true">⌄</span>
  </button>
  <Popover
    open={open === 'sort'}
    anchorRef={sortRef}
    ariaLabel="任务排序"
    onOpenChange={(next) => setOpen(next ? 'sort' : null)}
  >
    {sortOptions.map((option) => {
      const [sort_by, order] = option.value.split(':') as [TodoFilters['sort_by'], TodoFilters['order']]
      return <button key={option.value} className={optionClass} onClick={() => patch({ sort_by, order })}>
        {option.label}
      </button>
    })}
  </Popover>
</div>
```

- [ ] **Step 4: Run tests and verify GREEN**

Run the Task 3 command. Expected: all TaskFilters tests pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add frontend/src/features/todos/TaskFilters.tsx \
  frontend/src/features/todos/__tests__/TaskFilters.test.tsx
git commit -m "fix(frontend): unify task sorting control"
```

### Task 4: Full verification and real-browser acceptance

**Files:**
- No production files expected.

- [ ] **Step 1: Run complete frontend gates**

```bash
cd frontend
corepack pnpm lint
corepack pnpm test:coverage -- --run
corepack pnpm build
```

Expected: lint exits zero, all frontend tests pass, coverage thresholds remain satisfied, and Vite produces the production bundle.

- [ ] **Step 2: Run Chromium regression coverage**

Stop only the running frontend container if port 3000 is occupied, run the focused Mock E2E, and restore it in a shell trap:

```bash
restore_frontend() { docker compose -p todolist-agent start frontend >/dev/null; }
trap restore_frontend EXIT
docker compose -p todolist-agent stop frontend >/dev/null
corepack pnpm exec playwright test e2e/mock/smoke.spec.ts --project=chromium
restore_frontend
trap - EXIT
```

Expected: Chromium smoke passes and the live frontend container is restored.

- [ ] **Step 3: Rebuild and restart the frontend image**

```bash
cd ..
docker compose -p todolist-agent build frontend
docker compose -p todolist-agent up -d --force-recreate --wait frontend
```

Expected: the frontend uses the new image and all five services remain healthy.

- [ ] **Step 4: Verify the three visual paths in the real app**

Use Playwright against `http://127.0.0.1:3000` with the existing local prototype session:

- set theme to dark and open `Meta+K`; computed dialog and textarea backgrounds must not be white;
- open `/assistant`; textarea starts at two rows, grows on multiline input, reaches overflow at the automatic limit, and retains `resize: vertical`;
- open `/tasks`; sorting is a button, its Popover opens, and selecting “截止时间” updates the trigger;
- capture screenshots to `/tmp` only for inspection; do not add new baselines without explicit visual approval.

Expected: all assertions pass with no console errors.

- [ ] **Step 5: Push the completed main branch**

```bash
git status --short
git push origin main 2>/dev/null || git push origin master
```

Expected: tracked worktree is clean and the active main branch is synchronized with the remote. The ignored local `.env` remains uncommitted.

## Plan self-review

- Spec coverage: command palette theme, B-density composer, automatic limit, overflow, manual resize, reset, unified sorting, accessibility, browser verification, Docker deployment, and push are each mapped to a task.
- Placeholder scan: the plan contains no deferred implementation markers or unresolved choices.
- Type consistency: `useExpandableTextarea`, `COMPOSER_DEFAULT_HEIGHT`, `COMPOSER_AUTO_MAX_HEIGHT`, `open`, `sortValue`, and `sortOptions` keep the same names and contracts across tests and implementation.
