# Workspace breadcrumb implementation

Approved design uses connection > schema > table selectors in the workspace header. The sidebar retains its independent width and an always-accessible collapse control. Connection states appear as dots in the connection picker. Long connection details move into the picker.

1. Reuse ConnectionSwitcher in the header, preserving profile context actions and guarded connection switching. Remove the sidebar connection card and right-side host display.
2. Add a searchable object picker using the existing Radix Popover and shared controls. Scope schema options to the current connection and table options to the selected schema. Preserve loading, error, disconnected and empty states. Use existing navigation and query-schema state.
3. Preserve sidebar collapse/restore, schema filters, tab persistence and pending-edit guards. Move the query execution schema control into the breadcrumb.
4. Verify dependent selectors, keyboard navigation, disconnected profiles, pending changes and sidebar restoration with browser tests. Build TypeScript/Vite and inspect the resulting interface.

Existing schema detail and ERD tabs remain available through their existing entry points.
