# Changelog

All notable changes to Canvas PDF Composer are documented here.

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
