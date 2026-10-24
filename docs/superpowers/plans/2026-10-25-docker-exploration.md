# Docker exploration improvements

User approved all six proposed improvements, in this order: context menus, graph readability, list view. Implement in this chat, preserving existing work.

- [x] Reuse ContextMenu with optional destructive item styling; bind actions to the clicked resource and retain stale/context/confirmation guards. Canvas menu offers fit, arrange, reset.
- [x] Group the all-resources canvas by project, initially showing containers. Expand groups or select a container to reveal dependencies. Keep unreferenced resources discoverable. Consolidate canvas controls, zoom and minimap toggle.
- [x] Add a resource table with shared selection, search/type/status filters and resource context menus. Add running/stopped/error project counts and neighbor-only focus.
- [x] Consolidate project creation/search into one toolbar. Test remote/stale mutation guards, overview expansion, list filters, keyboard menus and selection across views; build and visually inspect both themes.

Files: ContextMenu.tsx (optional semantic variant), docker/view.ts (pure view derivation), Graph.tsx (layout/groups/menu/controls), ResourceTable.tsx (table), DockerWorkspace.tsx (state/actions), ComposeManager.tsx (toolbar slot), docker.css, unit and browser tests.

Validation: production build passed (existing bundle-size warning); 68 unit tests and 33 Docker/shared-context-menu browser tests passed. Dark graph and dark/light list screenshots inspected. Docker execution is mocked in browser tests.
