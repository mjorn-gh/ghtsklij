import { defineConfig } from 'vitest/config';
import fileViewerRenderers from '@file-viewer/vite-plugin';

/**
 * Content Security Policy for the preview document.
 *
 * Served as a header by the dev and preview servers. `index.html` carries the same policy in a
 * `<meta>` tag so it still applies on a static host that cannot send headers; the header form is
 * the one that matters in a real deployment, because `frame-ancestors` is ignored in meta form and
 * that directive is what stops an unrelated site from embedding the preview.
 *
 * `wasm-unsafe-eval` is required by the pdf.js WebAssembly decoders (OpenJPEG, JBIG2, QCMS).
 * `connect-src` stays tight because the viewer never fetches the document itself — the host page
 * downloads it and transfers the bytes over a MessagePort. Keep it that way: it is what makes
 * “the viewer cannot call home” readable off the policy instead of something to test for.
 */
const contentSecurityPolicy = (dev: boolean): string =>
  [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src 'self' blob: data:${dev ? ' ws:' : ''}`,
    "worker-src 'self' blob:",
    // The email renderer puts the message body in a nested iframe of its own, bare-sandboxed and
    // carrying its own policy, so remote images and scripts in an email cannot load. That frame is
    // a srcdoc, hence 'self' rather than 'none'.
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join('; ');

const securityHeaders = (dev: boolean): Record<string, string> => ({
  'Content-Security-Policy': contentSecurityPolicy(dev),
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
});

export default defineConfig({
  base: './',
  plugins: [
    // Copies each renderer's worker, WASM, cMap and font assets out of its package. Renderers
    // stay explicit in application code, so nothing is auto-registered here.
    fileViewerRenderers({
      renderers: ['pdf', 'word', 'spreadsheet', 'email', 'image'],
      autoPresets: false,
      inject: false,
      scan: false,
      copyAssets: { mode: 'both' },
    }),
  ],
  server: { headers: securityHeaders(true) },
  preview: { headers: securityHeaders(false) },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
