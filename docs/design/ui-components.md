# UI component system

Woojoo uses shadcn/ui (New York / Radix) components stored in `src/components/ui`, with Tailwind CSS v4. Add components with `npx shadcn@latest add <name>` and retain the `@/lib/utils` import. The `cn` helper composes class names with clsx and tailwind-merge.

`src/ui.css` defines Tailwind mappings and cascade layers. `src/workspace-design.css` defines semantic light/dark tokens and dense desktop layout. Existing layout rules stay in the `legacy` layer; component styles and utilities take priority. SQL editor and virtualized data-grid behavior are unchanged. ERD uses the same semantic colors.

Use Button variants for action hierarchy, Input/Textarea/NativeSelect for forms, Badge for compact status, and Separator for boundaries. Native checkbox/color/range inputs retain their browser semantics through the Input adapter. Bare button sizing is reserved for tabs, tree rows, and icon controls.

ModalSurface composes shadcn's Dialog primitives with existing forms, localized accessible titles, pending-operation dismissal guards, and focus restoration. Outside clicks do not discard forms. Context menus use DropdownMenu with collision handling, keyboard navigation, and focus restoration to the invoking object. Settings and workbench keyboard shortcuts remain unchanged.

The visual direction is neutral surfaces, a restrained blue action color, 4–12px corner radii, 12px controls, and consistent spacing. Both themes are supported through `data-theme`; no external font requests are required. The upstream MIT license is in `docs/licenses/shadcn-ui.txt`.
