# Changelog

All notable changes to Canvas PDF Composer are documented here.

## v0.2.1 — 2026-10-06

### Fixed

- Recognize Canvas Module `File` items by their stable `content_id`, including URLs such as `/courses/:course/files/:file_id?module_item_id=...`.
- Fetch original PDF response bytes with the current authenticated Canvas session instead of printing the Canvas file page or Chrome PDF viewer.
- Use Canvas Files API metadata to distinguish PDFs from Office/DocViewer resources.
- Increase resource capture timeout for larger lecture slide decks.
- Add CI syntax/build checks for the Canvas collector and packaged extension.


## v0.2.0 — 2026-10-06

### Added

- Renamed the product to **Canvas PDF Composer**.
- Added capture support for Canvas file resources and authenticated document previews.
- Added Google Slides detection and PDF export handling.
- Added external URL capture through Chromium PDF rendering.
- Added resource ordering so captured material follows Canvas module order.
- Added a static GitHub Pages website and packaged Chrome extension download.
- Added a formal GitHub release workflow and documentation entry points.

### Fixed

- Fixed communication between the Canvas MAIN world collector and the extension background worker.
- Preserved source links for resources that cannot be captured automatically.
- Updated generated PDF metadata to use the Canvas PDF Composer name.

## v0.1.0 — 2026-09-28

- Initial PDF Composer extension.
- Merge open PDF tabs and local PDF files.
- Build a structured Canvas course review from module content.
- Download the rendered review as a PDF.
