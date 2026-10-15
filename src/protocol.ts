/**
 * Message contract between the host page and the preview app running in a sandboxed iframe.
 *
 * The handshake carries no payload beyond a transferred {@link MessagePort}. The document itself
 * travels over that port as bytes, so the frame never issues a request for it and its CSP can
 * forbid outbound connections entirely.
 */

export const PROTOCOL_VERSION = 1;

export const HANDSHAKE_TYPE = 'document-preview/handshake';

/** Sent to the iframe with a pinned `targetOrigin`. Carries a port, never a document URL. */
export interface HandshakeMessage {
  readonly type: typeof HANDSHAKE_TYPE;
  readonly protocolVersion: number;
}

/**
 * Host to preview, over the port.
 *
 * The bytes travel instead of the URL, so the frame needs no network access of its own. The host
 * does the download and never parses what it forwards.
 */
export type PreviewCommand = {
  readonly type: 'load';
  readonly bytes: ArrayBuffer;
  readonly filename: string;
};

/** Preview to host, over the port. */
export type PreviewEvent =
  | { readonly type: 'ready'; readonly protocolVersion: number }
  | { readonly type: 'rendered'; readonly filename: string }
  | { readonly type: 'error'; readonly message: string };

export const createHandshakeMessage = (): HandshakeMessage => ({
  type: HANDSHAKE_TYPE,
  protocolVersion: PROTOCOL_VERSION,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isHandshakeMessage = (value: unknown): value is HandshakeMessage =>
  isRecord(value) && value.type === HANDSHAKE_TYPE && value.protocolVersion === PROTOCOL_VERSION;

export const isPreviewCommand = (value: unknown): value is PreviewCommand =>
  isRecord(value) &&
  value.type === 'load' &&
  value.bytes instanceof ArrayBuffer &&
  typeof value.filename === 'string';

export const isPreviewEvent = (value: unknown): value is PreviewEvent =>
  isRecord(value) &&
  (value.type === 'ready' || value.type === 'rendered' || value.type === 'error');

/**
 * Accepts the schemes a pre-signed object URL can legitimately use.
 *
 * `javascript:`, `data:` and `blob:` are rejected so a hostile host page cannot turn the preview
 * into a script-execution or same-document-exfiltration sink. Plain http is confined to loopback
 * so a local dev server still works without weakening deployed behaviour. Credentials embedded in
 * the authority are rejected outright — a pre-signed URL never carries them.
 */
export const isAllowedDocumentUrl = (candidate: string): boolean => {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.username !== '' || url.password !== '') {
    return false;
  }
  if (url.protocol === 'https:') {
    return true;
  }
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
  );
};

/** Generous upper bound; nothing legitimate approaches it. */
const MAX_FILENAME_LENGTH = 512;

const FALLBACK_STEM = 'document';

/** No printable meaning in a filename, and they can confuse a renderer's own text handling. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;

/** Conservative shape for the part that selects a renderer. */
const EXTENSION = /^[A-Za-z0-9]{1,12}$/;

/**
 * Derives a display filename from a URL, or from a name the host supplies.
 *
 * Separators are normalized, the last path segment is kept and trimmed, and only blank, `.` and
 * `..` are rejected. The filter stays off non-ASCII deliberately — narrowing it would turn
 * `Lieferschein_Zürich.pdf` into the fallback. Control characters are dropped, since nothing
 * legitimate carries them.
 *
 * The extension is not cosmetic: the viewer picks its renderer from it. So a rejected name still
 * keeps its extension, and a name without one yields a stem alone rather than a guess — routing an
 * unknown file to some default renderer would be worse than failing to render it.
 */
export const resolveDisplayFilename = (url: string, provided?: string): string => {
  const raw = lastSegment(provided ?? lastPathSegment(url));
  const candidate = raw.replace(CONTROL_CHARACTERS, '').trim();

  if (
    candidate !== '' &&
    candidate !== '.' &&
    candidate !== '..' &&
    candidate.length <= MAX_FILENAME_LENGTH
  ) {
    return candidate;
  }

  const extension = extensionOf(candidate) || extensionOf(lastPathSegment(url));
  return extension ? `${FALLBACK_STEM}.${extension}` : FALLBACK_STEM;
};

const extensionOf = (value: string): string => {
  const dot = value.lastIndexOf('.');
  const extension = dot === -1 ? '' : value.slice(dot + 1);
  return EXTENSION.test(extension) ? extension : '';
};

const lastSegment = (value: string): string => {
  const normalized = value.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
};

const lastPathSegment = (url: string): string => {
  try {
    const segments = new URL(url).pathname.split('/');
    return decodeURIComponent(segments[segments.length - 1] ?? '');
  } catch {
    return '';
  }
};
