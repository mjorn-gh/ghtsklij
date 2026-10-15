# document-preview

Renders a document in the browser inside a **sandboxed iframe**, so that a malicious file can never
execute script in the context of the application that embeds it.

This repo is the frame's side only. The embedding application downloads the document and transfers
the **bytes** in over a `MessageChannel`. The frame fetches nothing, which is what lets it run under
`connect-src 'self' blob: data:` — there is no outbound destination for a compromised renderer to
use.

Supported today: PDF, Word, spreadsheets, email and images.

## Deploying it

A push to `main` builds and publishes to GitHub Pages (`.github/workflows/pages.yml`). Enable Pages
once under **Settings → Pages → Source: GitHub Actions**; the workflow needs no secrets.

The build uses a relative `base`, so it works at `<account>.github.io/<repo>/` without the repo name
being configured anywhere.

### What a static host can and cannot give you

`index.html` carries the Content-Security-Policy in a `<meta>` tag, because a static host cannot
send response headers. That covers every directive except **`frame-ancestors`**, which is ignored in
meta form — and that is the one restricting who may embed the viewer. Anyone can frame a Pages
deployment. For a real deployment, send the policy from `vite.config.ts` as a header and add
`frame-ancestors` naming the embedding application.

Everything else holds: a Pages deployment is a genuine third-party origin, so an application
embedding it from anywhere else gets the cross-origin isolation the design depends on.

## Embedding it

The host page owns the document URL and the session. It creates the frame, hands over one end of a
`MessageChannel`, downloads the document in its own origin, and transfers the bytes.

```html
<iframe id="preview" sandbox="allow-scripts allow-same-origin"></iframe>
```

```js
const VIEWER = 'https://<account>.github.io/<repo>/index.html';
const viewerOrigin = new URL(VIEWER).origin;

const frame = document.querySelector('#preview');
const channel = new MessageChannel();

channel.port1.onmessage = (event) => console.log('preview:', event.data);
channel.port1.start();

frame.addEventListener(
  'load',
  async () => {
    frame.contentWindow.postMessage(
      { type: 'document-preview/handshake', protocolVersion: 1 },
      viewerOrigin,
      [channel.port2],
    );

    const response = await fetch(documentUrl);
    const bytes = await response.arrayBuffer();
    channel.port1.postMessage({ type: 'load', bytes, filename: 'delivery-note.pdf' }, [bytes]);
  },
  { once: true },
);

frame.src = VIEWER;
```

Two things that are not optional:

- **The viewer must be on a different origin than the host page.** `allow-same-origin` lets the
  frame keep a real origin rather than an opaque one, which is what lets pdf.js start a real Worker
  — an opaque origin cannot, and its main-thread fallback silently drops ICC profiles, cMaps and
  standard fonts. It is safe only because that origin is not the host's. A frame that is
  same-origin with its embedder can reach `parent`, strip its own `sandbox` attribute and escape.
- **The host downloads, never the frame.** That is what keeps `connect-src` free of any outbound
  destination, so "can the viewer call home" is answered by reading the policy rather than by
  watching a network log.

`src/protocol.ts` is the contract: message shapes, the type guards, `isAllowedDocumentUrl` for
vetting a URL before fetching it, and `resolveDisplayFilename` for deriving the display name. It
contains no renderer code, so a host written in this repo's idiom can import from it directly.

The viewer never receives a document URL. That follows from the host doing the download rather than
motivating it: a short-lived URL scoped to the document already on display would tell a compromised
renderer nothing it does not already hold.

### Protocol

| Direction    | Message                                                   |
| ------------ | --------------------------------------------------------- |
| host → frame | `{ type: 'document-preview/handshake', protocolVersion }` |
| host → port  | `{ type: 'load', bytes, filename }`                       |
| frame → port | `{ type: 'ready', protocolVersion }`                      |
| frame → port | `{ type: 'rendered', filename }`                          |
| frame → port | `{ type: 'error', message }`                              |

The frame accepts the first handshake that comes from `window.parent` carrying exactly one port, and
ignores later ones, so a second window cannot swap in its own port afterwards.

## Test documents

Any URL the host fetches has to be reachable cross-origin from the host's own origin. These all
answer `200` with `Access-Control-Allow-Origin: *`:

| Format | URL                                                                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| pdf    | `https://pdfobject.com/pdf/sample.pdf`                                                                                                                                                           |
| docx   | `https://raw.githubusercontent.com/python-openxml/python-docx/master/features/steps/test_files/doc-default.docx`                                                                                 |
| doc    | `https://raw.githubusercontent.com/apache/poi/trunk/test-data/document/47304.doc`                                                                                                                |
| rtf    | `https://raw.githubusercontent.com/apache/tika/main/tika-parsers/tika-parsers-standard/tika-parsers-standard-modules/tika-parser-microsoft-module/src/test/resources/test-documents/testRTF.rtf` |
| xlsx   | `https://raw.githubusercontent.com/tafia/calamine/master/tests/any_sheets.xlsx`                                                                                                                  |
| xls    | `https://raw.githubusercontent.com/tafia/calamine/master/tests/any_sheets.xls`                                                                                                                   |
| ods    | `https://raw.githubusercontent.com/tafia/calamine/master/tests/any_sheets.ods`                                                                                                                   |
| csv    | `https://raw.githubusercontent.com/datasets/population/main/data/population.csv`                                                                                                                 |
| eml    | `https://raw.githubusercontent.com/postalsys/postal-mime/master/test/fixtures/mixed.eml`                                                                                                         |
| msg    | `https://raw.githubusercontent.com/TeamMsgExtractor/msg-extractor/master/example-msg-files/strangeDate.msg`                                                                                      |
| jpg    | `https://raw.githubusercontent.com/python-openxml/python-docx/master/features/steps/test_files/court-exif.jpg`                                                                                   |
| svg    | `https://raw.githubusercontent.com/twbs/icons/main/icons/file-earmark-text.svg`                                                                                                                  |

Sites that publish a download _page_ at a document URL answer `text/html` with no CORS header and
cannot be used, however much the path looks like a file.

`raw.githubusercontent.com` serves everything as `application/octet-stream` or `text/plain`, which
does not matter: the renderer is chosen from the filename, not the response type.

## Working on it

```bash
npm ci
npm run dev      # the viewer alone; it waits for a handshake until a host page sends one
npm test         # unit tests
npm run lint     # prettier + tsc
npm run build    # production bundle into dist/
```

The dev and preview servers send the full CSP as a header, including `frame-ancestors`, so local
behaviour matches a header-capable deployment rather than the Pages one.

Opening the viewer directly shows `Waiting for document-preview/handshake…` and nothing else — that
is correct. It renders only what a host transfers to it.

## Renderers

| Format family | Package                             | Extensions                                                      |
| ------------- | ----------------------------------- | --------------------------------------------------------------- |
| PDF           | `@file-viewer/renderer-pdf`         | `pdf`                                                           |
| Word          | `@file-viewer/renderer-word`        | `docx docm dotx dotm doc dot odt rtf odp`                       |
| Spreadsheet   | `@file-viewer/renderer-spreadsheet` | `xlsx xlsm xls xlsb csv tsv ods fods xlt xla`                   |
| Email         | `@file-viewer/renderer-email`       | `eml msg mbox`                                                  |
| Image         | `@file-viewer/renderer-image`       | `png jpg jpeg gif webp avif bmp ico svg tif tiff heic heif jxl` |

The viewer runs with `rendererMode: 'replace'` and `builtinRenderers: 'none'`, so these are the only
renderers in the registry — an unexpected content type fails instead of silently routing into one
that was never reviewed. The renderer is chosen from the filename extension, which is why
`resolveDisplayFilename` preserves it even when it rejects the rest of the name.

### What the renderers refuse to execute

- **PDF.** pdf.js has `enableScripting` false by default, and the `pdf.sandbox.mjs` bundle that
  would run document JavaScript is not shipped by the package at all.
- **Email.** The message body goes into a _nested_ iframe with a bare `sandbox` attribute — no
  scripts — carrying its own `Content-Security-Policy` of `img-src blob: data:` and
  `script-src 'none'`. Remote image references are rewritten to the message's own inline parts or
  dropped, so tracking pixels cannot load. `referrerPolicy` is `no-referrer`.
- **Word and RTF.** Rendered HTML passes through DOMPurify with `base`, `embed`, `form`, `iframe`,
  `object`, `script`, `style` and `template` forbidden, and `action`, `formaction` and `srcdoc`
  stripped.
- **SVG.** The image renderer only ever creates `img` elements — it never injects markup, and uses
  no `innerHTML` at all. An SVG therefore renders in the browser's restricted SVG-as-image context,
  where scripts do not run and external references do not load. That restriction is enforced by the
  browser rather than by a sanitiser, which is the stronger guarantee.

The viewer's CSP allows `frame-src 'self'` solely for the email renderer's nested frame.

## Dependency rules

- The `@file-viewer/*` packages are **pinned exactly**, not ranged, and `.npmrc` sets
  `save-exact=true` so an install cannot widen that. The review covers the versions in the lockfile.
- **Never install `@file-viewer/web-full` or `@file-viewer/preset-all`.** They pull
  `renderer-cad` → `@flyfish-dev/cad-viewer`, which is **AGPL-3.0-only**, into the dependency
  closure despite `web-full` declaring itself Apache-2.0. This is the package the upstream README
  recommends in its quick start. The packages actually installed here are Apache-2.0.
- Add renderers one at a time, with review. Each of the five present was checked for network egress,
  dynamic code execution, install-time scripts, hidden characters and licence before being added;
  `src/renderer.ts` carries the list and a test pins it, so a renderer cannot appear without that
  review.
- `renderer-geo` (`maplibre-gl`) and `renderer-drawing` (`plantuml-encoder`) make outbound requests
  by design. Neither is installed.

Runtime assets (the pdf.js worker, WASM, cMaps and fonts) are copied out of the renderer packages
into `public/` at build time and are not checked in.

## Known limits

- Binary `.doc` support is Word 97 and later. Word 6/95 files carry only a `WordDocument` stream,
  where the renderer expects the separate `0Table`/`1Table` stream Word 97 introduced, and fails
  with "Missing table stream".
- A workbook's hidden and very-hidden sheets are suppressed by both spreadsheet paths, but a visible
  _chartsheet_ is shown by the `xls` path and skipped by the `xlsx` one — so the same workbook can
  preview differently depending on how it was saved.
- The spreadsheet grid is canvas-rendered and does not stretch to fill the container.
- `rtf.js`, which supplies RTF bodies for `.msg` messages, has not been published since 2022. It is
  an unmaintained parser of untrusted input, tolerable here only because of where it runs: inside
  the sandboxed frame, on an origin that holds nothing, with its output sanitised.
- No end-to-end browser test. The unit suite covers the protocol contract and the viewer
  configuration; nothing automated has rendered a real document.
