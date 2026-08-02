# Agent Disclosures and Profile Counts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the compact Agent panel use the same per-turn disclosure layout as the main assistant, collapse API results by default everywhere, and show live Todo counts on the profile page.

**Architecture:** Reuse `AgentTurn` as the single renderer for durable conversation turns in both Agent surfaces. Keep result disclosure state local to each `ActionResult`, and source profile counts from the existing `useTodoSummary` query contract used by the tasks dashboard.

**Tech Stack:** React 19, TypeScript, TanStack Query, Vitest, Testing Library, Playwright.

---

### Task 1: Collapsible API result cards

**Files:**
- Modify: `frontend/src/features/agent/AgentStepTimeline.tsx`
- Modify: `frontend/src/features/agent/__tests__/AgentPanel.test.tsx`
- Modify: `frontend/src/styles/global.css`

- [x] **Step 1: Write the failing test**

Add a test that renders an action result, asserts its result-details button has `aria-expanded="false"` and its JSON body is hidden, clicks the button, and asserts the JSON becomes visible.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/agent/__tests__/AgentPanel.test.tsx`
Expected: FAIL because the result card has no disclosure button and renders JSON immediately.

- [x] **Step 3: Write minimal implementation**

Give `ActionResult` local `expanded` state, a labelled disclosure button with `aria-controls`, and a hidden result region. Add compact chevron and focus styles.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/agent/__tests__/AgentPanel.test.tsx`
Expected: PASS.

### Task 2: Reuse turn layout in compact Agent panel

**Files:**
- Modify: `frontend/src/features/agent/AgentPanel.tsx`
- Modify: `frontend/src/features/agent/__tests__/AgentPanel.test.tsx`
- Modify: `frontend/src/styles/global.css`

- [x] **Step 1: Write the failing test**

Render a completed durable turn in `AgentPanel`; assert DOM order is user message, execution details, assistant response and execution details default collapsed.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/agent/__tests__/AgentPanel.test.tsx`
Expected: FAIL because the panel separately renders all messages followed by the current timeline.

- [x] **Step 3: Write minimal implementation**

Sort `session.turns` by ordinal and render `AgentTurn` for each one, wiring actions only for the current turn. Preserve a legacy fallback for session values without durable turns.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/agent/__tests__/AgentPanel.test.tsx`
Expected: PASS.

### Task 3: Live profile task counts

**Files:**
- Modify: `frontend/src/pages/ProfilePage.tsx`
- Modify: `frontend/src/pages/__tests__/ProfilePage.test.tsx`
- Modify: `frontend/e2e/mock/profile-settings.spec.ts`

- [x] **Step 1: Write the failing tests**

Assert the profile uses Todo API totals for total, completed, and active counts, including the account-status total.

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/pages/__tests__/ProfilePage.test.tsx`
Expected: FAIL because completed and active values are hard-coded and total comes from the auth snapshot.

- [x] **Step 3: Write minimal implementation**

Call `useTodoSummary()` in `ProfilePage` and display its three totals in both profile count surfaces.

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/pages/__tests__/ProfilePage.test.tsx`
Expected: PASS.

### Task 4: Full verification

**Files:**
- Verify all modified frontend files.

- [x] **Step 1: Run focused and related unit tests**

Run: `pnpm test src/features/agent/__tests__/AgentPanel.test.tsx src/features/agent/__tests__/AgentTurn.test.tsx src/pages/__tests__/ProfilePage.test.tsx src/pages/__tests__/AssistantPage.test.tsx`
Expected: PASS.

- [x] **Step 2: Run static checks and build**

Run: `pnpm lint && pnpm build`
Expected: PASS.

- [x] **Step 3: Verify browser behavior**

Use Playwright against the local app to confirm both Agent surfaces default-hide API JSON, disclose it on click, the side-panel details sit between user and assistant messages, and profile totals match the tasks dashboard.
