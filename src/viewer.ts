/**
 * Preview app. Runs inside the sandboxed iframe and renders the bytes the host transfers in.
 *
 * The document URL never reaches this document, so it cannot leak through `location`, history, a
 * `Referer` header, or a screenshot of the frame.
 *
 * Rendering is all this does. Download, print and export stay with the host page, which has the
 * URL and the session; putting them here would mean granting the frame capabilities it should not
 * have, for a worse result.
 */

import type { ViewerController } from '@file-viewer/web';
import { mountDocument } from './renderer';
import {
  HANDSHAKE_TYPE,
  PROTOCOL_VERSION,
  isHandshakeMessage,
  isPreviewCommand,
  resolveDisplayFilename,
  type PreviewEvent,
} from './protocol';

const container = document.querySelector<HTMLDivElement>('#viewer');
const status = document.querySelector<HTMLParagraphElement>('#status');

if (!container || !status) {
  throw new Error('preview shell is missing its mount points');
}

let controller: ViewerController | null = null;
let port: MessagePort | null = null;

/**
 * The document, held as a Blob so it can be rendered more than once.
 *
 * pdf.js takes ownership of any ArrayBuffer it is handed and detaches it, so a buffer survives
 * exactly one render. The viewer re-loads its source whenever the theme changes, which then read a
 * zero-length buffer and silently painted nothing. A Blob is immutable and yields a fresh buffer on
 * every read, so the re-load works without this module having to intervene.
 */
let document_: { blob: Blob; filename: string } | null = null;

const setStatus = (message: string): void => {
  status.textContent = message;
};

const post = (event: PreviewEvent): void => {
  port?.postMessage(event);
};

const fail = (message: string): void => {
  setStatus(message);
  post({ type: 'error', message });
};

/** Renders the held document, replacing any previous one. */
const render = async (): Promise<void> => {
  if (!document_) {
    throw new Error('no document to render');
  }
  const { blob, filename } = document_;

  controller?.destroy();
  controller = await mountDocument(container, blob, filename);
};

const handleCommand = async (data: unknown): Promise<void> => {
  if (!isPreviewCommand(data)) {
    fail('unsupported command');
    return;
  }

  const filename = resolveDisplayFilename('', data.filename);
  document_ = { blob: new Blob([data.bytes]), filename };
  setStatus(`Loading ${filename}…`);
  try {
    await render();
    setStatus(filename);
    post({ type: 'rendered', filename });
  } catch (error) {
    fail(error instanceof Error ? error.message : 'preview failed');
  }
};

/**
 * Accepts the first handshake from the embedding window and keeps the port.
 *
 * Only `window.parent` can address this frame, and later handshakes are ignored, so a second
 * window cannot swap in its own port once the channel is established.
 */
const handleHandshake = (event: MessageEvent): void => {
  if (port !== null || event.source !== window.parent) {
    return;
  }
  if (!isHandshakeMessage(event.data) || event.ports.length !== 1) {
    return;
  }

  const [incoming] = event.ports;
  if (!incoming) {
    return;
  }

  port = incoming;
  incoming.onmessage = (message) => void handleCommand(message.data);
  incoming.start();
  post({ type: 'ready', protocolVersion: PROTOCOL_VERSION });
  setStatus('Waiting for a document…');
};

window.addEventListener('message', handleHandshake);
setStatus(`Waiting for ${HANDSHAKE_TYPE}…`);
