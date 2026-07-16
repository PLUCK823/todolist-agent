# Dark Controls and Assistant Composer Design

## Goal

Correct three high-fidelity UI regressions without changing the existing product structure:

1. make the quick-question dialog fully theme-aware in dark mode;
2. replace the oversized standalone Assistant composer with the approved compact, expandable variant;
3. make task sorting visually and behaviorally consistent with the adjacent status and priority filters.

## Scope

The change is limited to `CommandPalette`, `AssistantPage`, `TaskFilters`, their styles, and focused frontend tests. It does not change Agent protocols, Todo query semantics, theme preferences, navigation, or backend APIs.

## Design decisions

### Quick-question dialog

- Remove hard-coded white panel surfaces and white outlines.
- Use the existing theme tokens for panel, control, border, text, muted text, and focus states.
- Preserve the existing 630 px maximum width, dialog radius, overlay blur, keyboard shortcuts, focus trap, and motion.
- In dark mode, the header, prompt area, and footer must read as one dark layered surface with no white perimeter.
- Light mode must retain the existing visual hierarchy.

### Standalone Assistant composer

- Use the user-approved **B · two-line comfortable** density.
- Default total composer height is approximately 100 px, with a two-line prompt area.
- The textarea grows with content until approximately 220 px.
- Beyond the automatic-growth limit, the textarea uses an internal vertical scrollbar.
- The resize handle remains available so the user can manually expand the textarea up to approximately 360 px.
- A manual height remains stable while editing the current draft. Submitting and clearing the draft restores the default height.
- Keep the explanatory footer and send action, but reduce their spacing so they do not create an empty card.
- Preserve disabled, focus, keyboard, and reduced-motion behavior.

### Task sort control

- Replace the native `select` with the same trigger-and-Popover pattern used by status and priority.
- Match trigger height, radius, border, background, typography, spacing, chevron, hover, and focus treatment.
- The trigger label reflects the current sort value.
- The menu exposes the existing four choices without changing their query mapping:
  - recently created;
  - due date;
  - priority high to low;
  - priority low to high.
- Selecting an option closes the menu, resets pagination to page 1, and restores focus consistently with the other filters.
- Keyboard navigation and accessible names remain available through the shared Popover behavior.

## Component boundaries

- `CommandPalette` continues to own shortcut and submission behavior; only theme-facing classes and regression assertions change.
- `AssistantPage` owns the draft and composer reset. A small reusable textarea sizing hook is acceptable if it has no product-specific dependencies.
- `TaskFilters` owns all three filter menus and keeps one open-menu state so opening one closes the others.
- Theme colors remain centralized in existing CSS variables; no component-specific dark-mode color literals are introduced.

## Testing and acceptance

### Automated regression tests

- Assert that the command palette uses theme surfaces rather than a hard-coded white panel contract.
- Assert that the Assistant textarea starts at the approved two-line density, grows to its automatic limit, scrolls after overflow, allows vertical resizing, and resets after successful submission.
- Assert that sorting is a Popover trigger rather than a native select, maps all four options correctly, closes competing filter menus, and restores focus on Escape.
- Run frontend lint, focused tests, full coverage tests, and production build.

### Browser acceptance

At the real local application in both light and dark modes:

1. open the quick-question dialog and confirm no white perimeter or footer remains in dark mode;
2. open the Assistant page and confirm the composer is compact before typing, expands with content, scrolls at the automatic limit, and can be dragged taller;
3. open task sorting and confirm its closed and open states match status and priority;
4. verify all three controls remain usable by keyboard and show a visible focus state.

## Out of scope

- New themes or color palettes.
- Redesigning the Assistant workspace columns or message timeline.
- Changing filter or sorting API contracts.
- Introducing a general-purpose form component library.
