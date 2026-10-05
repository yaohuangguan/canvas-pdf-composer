# Canvas PDF Composer

> Turn scattered Canvas course materials into one portable PDF.

[![Version](https://img.shields.io/badge/version-v0.2.0-111827)](https://github.com/yaohuangguan/canvas-pdf-composer/releases/latest)
[![Chrome](https://img.shields.io/badge/Chrome-120%2B-4285F4?logo=googlechrome&logoColor=white)](#install)
[![Local first](https://img.shields.io/badge/local--first-yes-16a34a)](#privacy--permissions)

**[Download latest release](https://github.com/yaohuangguan/canvas-pdf-composer/releases/latest/download/canvas-pdf-composer.zip)** · **[All releases](https://github.com/yaohuangguan/canvas-pdf-composer/releases)** · **[Website source](https://github.com/yaohuangguan/canvas-pdf-composer/tree/gh-pages)** · **[Report an issue](https://github.com/yaohuangguan/canvas-pdf-composer/issues)**

Canvas PDF Composer is a local-first Chrome extension for students who want a single review document instead of a course spread across Canvas pages, PDFs, slide decks, files and external links.

## What it does

### Canvas Course → one PDF

Open a Canvas **Modules** page, choose what to include, and build one review PDF that preserves the course structure.

It can collect:

- Canvas course pages
- discussions, assignments and quizzes when selected
- direct PDF files
- Canvas file previews, including PPT/PPTX where Canvas provides a printable preview
- Google Slides through the official PDF export endpoint
- external links by opening the resource and printing the rendered page to PDF

Captured resources are appended to the final export in module order. Items that cannot be captured are kept as source links instead of being silently dropped.

### Merge PDFs

Canvas PDF Composer can also merge PDFs independently of Canvas:

- detect PDF tabs already open in Chrome
- add local PDF files
- reorder selected documents
- merge every page locally with `pdf-lib`
- download one combined PDF

## Why this exists

Canvas is good at organizing a course, but revision material is often fragmented across module pages, embedded documents, slide decks, linked resources and downloadable PDFs.

Canvas PDF Composer turns that structure into something portable:

```text
Canvas Modules
      ↓
Pages · PDFs · PPT/PPTX previews · Google Slides · Links
      ↓
One review PDF
```

## Install

### 1. Download

Download the latest packaged extension:

**[canvas-pdf-composer.zip](https://github.com/yaohuangguan/canvas-pdf-composer/releases/latest/download/canvas-pdf-composer.zip)**

### 2. Unzip

Extract the ZIP somewhere you want to keep the extension.

### 3. Load it in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the extracted folder

Then open a Canvas course **Modules** page and choose **Canvas Course** in the extension.

## How Canvas capture works

Canvas PDF Composer uses the Canvas session already active in your browser. It does not ask for or store your Canvas password.

For course content it uses several strategies:

| Content | Strategy |
| --- | --- |
| Canvas pages | Reads page content through the current Canvas session |
| PDF files | Uses the PDF directly where possible |
| PPT/PPTX and Office files | Uses Canvas's authenticated document preview when available |
| Google Slides | Requests the presentation's PDF export using the current browser session |
| External web pages | Opens the page in a background tab and renders it through Chromium |

This is intentionally browser-native rather than a server-side scraping service.

## Privacy & permissions

Canvas PDF Composer is designed to be local-first.

- PDF merging happens in the browser.
- Canvas credentials are never copied into the extension.
- Course documents are not uploaded to a Canvas PDF Composer server.
- Host access is requested only when a selected remote resource needs to be read.
- Local `file://` PDFs require Chrome's **Allow access to file URLs** setting, or you can add them manually.

The extension currently uses Chrome's `debugger` permission to access Chromium's `Page.printToPDF` renderer. That permission is powerful, so the implementation keeps its use narrow and task-specific. See [PRIVACY.md](PRIVACY.md) for details.

## Known limitations

- PPT/PPTX fidelity depends on the preview Canvas exposes for that file.
- Some authenticated third-party links, anti-bot pages or unsupported embedded tools may not render correctly.
- External resources that cannot be captured remain linked in the generated review instead of disappearing.
- The extension is currently distributed as an unpacked Chrome extension rather than through the Chrome Web Store.

## Development

Requirements: Node.js 20+ and a current Chromium-based browser.

```bash
git clone https://github.com/yaohuangguan/canvas-pdf-composer.git
cd canvas-pdf-composer
npm install
npm run check
npm run build
```

Load `dist/` from `chrome://extensions` using **Load unpacked**.

For development with automatic rebuilds:

```bash
npm run watch
```

## Project structure

```text
public/                 Extension manifest and popup UI
src/popup.js            PDF merge UI and Canvas launcher
src/canvas.js           Canvas course collector and review builder
src/background.js       Resource capture and Chromium PDF rendering
scripts/build.mjs       Extension build pipeline
docs/                   Static product website and packaged download
```

## Releases

Release notes and downloadable builds live on GitHub Releases:

**https://github.com/yaohuangguan/canvas-pdf-composer/releases**

See [CHANGELOG.md](CHANGELOG.md) for the project history.

## Contributing

Issues and focused pull requests are welcome. Please include the Canvas item type, expected output, actual output and reproduction steps for capture bugs.

See [CONTRIBUTING.md](CONTRIBUTING.md).
