# Contributing

Thanks for helping improve Canvas PDF Composer.

## Development setup

```bash
npm install
npm run check
npm run build
```

Load `dist/` through `chrome://extensions` with Developer mode enabled.

## Bug reports

For Canvas capture bugs, include:

- Canvas item type (`Page`, `File`, `ExternalUrl`, etc.)
- file type or provider when relevant
- expected behavior
- actual behavior
- browser version
- minimal reproduction steps

Do not attach private course files, session cookies, access tokens or credentials to a public issue.

## Pull requests

Keep changes focused. Before opening a PR, run:

```bash
npm run check
npm run build
```

For changes to capture behavior, explain which resource type was tested and how the result was verified.
