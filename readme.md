# Canvas PDF Composer

A local-first Chrome extension for turning scattered browser documents into one portable PDF.

## Current tools

### Merge PDFs

- detects PDF tabs already open in Chrome
- lets the user select and reorder them
- accepts additional local PDF files
- merges all pages in the browser with `pdf-lib`
- downloads one combined PDF
- does not upload PDF bytes to a Canvas PDF Composer server

Remote HTTP/HTTPS PDFs request host access only when the user starts a merge. Local `file://` PDFs require Chrome's **Allow access to file URLs** toggle; users can always choose the files directly instead.

### Canvas Course

The Canvas importer grew out of a DIGIHLTH 706 study workflow. From a logged-in Canvas Modules page it:

- reads the module structure through the user's existing Canvas session
- collects selected course item types
- builds a clean combined review page with contents and source links
- downloads the rendered review as one PDF

The importer does not copy Canvas credentials into Canvas PDF Composer.

## Development

```bash
npm install
npm run build
```

Load `dist/` with **chrome://extensions → Developer mode → Load unpacked**.

The local Windows test build is also copied to:

```text
C:\Users\Administrator\Desktop\canvas-course-exporter
```

That compatibility path lets the previously loaded Canvas prototype be reloaded in place while it is renamed to Canvas PDF Composer.

## Publishing note

The direct Canvas HTML-to-PDF path currently uses Chrome's `debugger` permission to call Chromium's PDF renderer with the screen layout. Chrome requires `debugger` to be a required permission rather than an optional permission. Before Chrome Web Store publication, review whether the Canvas renderer should stay in the public build or move to a lower-permission export implementation.
