# Steel browser extension

Chrome and Edge (Manifest V3) side panel for WhatsApp Web, Gmail and LinkedIn.
Product notes, decisions, privacy and the Chrome Web Store steps live in
`docs/browser-extension.md` (pt-BR).

```
src/background.ts      service worker: the only place that talks to Steel
src/content/*.ts       one content script per site; reads name, phone, e-mail
src/sidepanel/         the side panel (plain DOM, no framework)
src/lib/               pure logic, unit-tested (95% coverage gate)
scripts/build.mjs      esbuild bundle + manifest version stamp + placeholder icons
scripts/check-package.mjs  fails when dist/ is not a loadable extension
```

Built and packaged by `.github/workflows/browser-extension.yml`; the zip is the
`steel-browser-extension` artifact. Auth is a personal API token (`stl_pat_`)
over `@steel-so/sdk`; see ADR 0034 and 0035.
