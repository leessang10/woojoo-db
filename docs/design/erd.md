# ERD workspace

Schema and table pages open one ERD tab per connection/schema. React Flow provides the interactive canvas and Dagre supplies automatic left-to-right layout. The editor uses existing theme and language preferences.

## Metadata

`read_erd` reads base tables, columns, PKs and outgoing FKs. PostgreSQL pairs `conkey` and `confkey` by ordinality, retaining composite constraints as one relationship. MySQL/MariaDB use `KEY_COLUMN_USAGE` ordered by ordinal position. Referenced tables outside the selected schema are included. Column metadata requests run with concurrency three. No table rows or DDL are requested.

The demo accurately contains only `public.users` and no foreign keys. Multiple-table/FK UI tests use a mocked native transport and are not evidence of live database connectivity.

## Editing and persistence

Table movement, width, header color and three shapes are editable. Relationships support custom additions, deletion, endpoint reconnection, source/target columns, label/label position, line shape/color/dashes and arrowheads. PK-only, PK/FK and all-column modes affect presentation without removing relationships.

Undo/redo retains up to 40 edits. A metadata refresh preserves visual styles, positions and custom relationships whose tables still exist. Deleted database relationships remain hidden until restored. All edits concern the ERD document, never the database.

The document is saved in local storage under engine/host/port/database/user/schema identity. Passwords and database row values are excluded. The open workspace also retains the document if local storage is unavailable.

## Export

html-to-image renders the full viewport content after fitting its bounds to all nodes and edge labels, independent of current pan/zoom. PNG uses an opaque theme background. jsPDF embeds the same raster to retain local font rendering, including Korean. Large exports scale to at most 8,000 pixels per side and 16 million pixels total.

Desktop exports use a Rust command with an `rfd` save dialog; cancellation does not report success. Browser previews download files. The native save-dialog interaction and live database metadata are not covered by the browser mocks.

## Upstream references

- https://reactflow.dev/learn/customization/custom-nodes
- https://reactflow.dev/examples/misc/download-image
- https://github.com/dagrejs/dagre
- https://github.com/bubkoo/html-to-image
- https://github.com/parallax/jsPDF

Redistribution notices are in `docs/ERD-THIRD-PARTY-NOTICES.txt`. React Flow attribution remains visible in the canvas.
