# Workspace UI

This is a database workbench. Its hierarchy is connection → schema → table → query → results.

- Use a fixed header and contiguous editor/results panes instead of nested dashboard cards.
- Keep database content literal. Do not infer decorative status or role badges from column names.
- Use neutral surfaces. Blue indicates selection, focus or a primary action; amber indicates staged changes.
- Use a 13px system UI font and monospace for SQL. Small metadata may use 11px, but never hide essential controls behind tiny labels.
- Keep sidebar, language and theme controls available when navigation is collapsed.
- Support Korean and English in the central `src/i18n.ts` catalog. Do not translate SQL, identifiers, connection names or data values. External database error details remain verbatim.
- Persist presentation preferences only; credentials remain session-only.
- Verify both languages and themes, including the minimum desktop size of 960 × 640.
- Test actual interactions: click, keyboard, reload and data preservation. A control that only looks interactive is not complete.
- Tabs own their SQL, editor history, results, staged edits, error, filter, sort and scroll position. They belong to a connection, and an asynchronous result must update its originating tab.
- Opening history creates a query tab. Opening a table focuses its existing table tab or creates one; it never clears another editor. Closing a tab with SQL or staged edits requires confirmation.
- Tab state is session-only. Do not imply SQL file saving or automatic recovery after restart.

References reviewed on 2026-10-20:

- [NN/g: AI Prototyping in Real Design Contexts](https://www.nngroup.com/articles/ai-prototyping/) — context, hierarchy, color and spacing matter more than generic visual patterns.
- [Linear: A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh) — consistent action placement and reduced visual noise.
- [Carbon: Data table guidelines](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines) — organize table actions and preserve data legibility.
