# Privacy

Canvas PDF Composer is designed as a local-first browser extension.

## Data handling

Canvas PDF Composer does not operate a backend service for uploaded course content. PDF merging and final document assembly happen inside the browser extension.

When the Canvas importer runs, it uses the user's existing authenticated browser session to request course material from Canvas and supported linked resources. Canvas credentials and passwords are not copied into or stored by Canvas PDF Composer.

## Permissions

The extension uses Chrome permissions for narrowly scoped product functions:

- `activeTab` and `scripting` — run the Canvas collector on the page the user explicitly opens.
- `tabs` — discover selected PDF tabs and temporarily open resources that need to be captured.
- `downloads` — save generated PDFs.
- `debugger` — call Chromium's PDF renderer for generated review pages and supported resource previews.
- optional host permissions — read selected HTTP/HTTPS PDF resources only when required.

## External resources

If a Canvas module links to a third-party resource, opening or capturing that resource is subject to the third party's own privacy policy and the user's existing browser session.

## Reports

If you find a privacy or security issue, open a GitHub issue without including private course material, credentials or authentication tokens.
