/**
 * Renderer configuration and mounting.
 *
 * Kept apart from the host protocol so the configuration the viewer actually runs with can be
 * asserted without standing up a document.
 */

import { mountViewer, type ViewerController, type ViewerOptions } from '@file-viewer/web';
import type { FileViewerRendererPluginInput } from '@file-viewer/core';
import pdfRenderer from '@file-viewer/renderer-pdf';
import wordRenderer, { registerFileViewerRtfLoader } from '@file-viewer/renderer-word';
import spreadsheetRenderer from '@file-viewer/renderer-spreadsheet';
import emailRenderer from '@file-viewer/renderer-email';
import imageRenderer from '@file-viewer/renderer-image';

/**
 * The renderers this viewer may reach, one per reviewed format family.
 *
 * Each was audited before it was added: no network egress, no dynamic code execution, no
 * install-time scripts, permissive licences. Adding one is a deliberate act, not a side effect of
 * installing a preset.
 */
const RENDERERS: FileViewerRendererPluginInput = [
  // Each renderer's published type is invariant in its container element, so none of them
  // structurally matches the option they are all meant to be passed to. Upstream typing gap.
  pdfRenderer as FileViewerRendererPluginInput,
  wordRenderer as FileViewerRendererPluginInput,
  spreadsheetRenderer as FileViewerRendererPluginInput,
  emailRenderer as FileViewerRendererPluginInput,
  imageRenderer as FileViewerRendererPluginInput,
];

/**
 * RTF rendering is opt-in, and `.msg` messages commonly carry an RTF-only body — without this they
 * fall back to plain text with a notice. The library is loaded lazily, so it is only fetched when a
 * document actually contains RTF.
 *
 * `rtf.js` has not been published since 2022. It is an unmaintained parser of untrusted input,
 * which is tolerable here only because of where it runs: inside the sandboxed frame, on an origin
 * that holds nothing, with its output sanitized and external links and resources blocked.
 */
registerFileViewerRtfLoader(() => import('rtf.js'));

/**
 * `rendererMode: 'replace'` with `builtinRenderers: 'none'` starts from an empty registry, so only
 * the renderers listed above are reachable — an unexpected content type fails instead of routing
 * into one nobody reviewed.
 *
 * Two toolbars exist. file-viewer's shell one floats bottom-right and carries download, print,
 * export and the theme toggle: all either blocked by the sandbox or the host's job, so it is off.
 * The renderer's own sits at the top with page navigation and zoom, which act inside the document,
 * so it stays, with its outline pane collapsed.
 */
export const VIEWER_OPTIONS = {
  rendererMode: 'replace',
  builtinRenderers: 'none',
  autoRenderers: false,
  renderers: RENDERERS,
  toolbar: false,
  pdf: { defaultNavigationVisible: false },
} as const satisfies ViewerOptions;

/**
 * Mounts a viewer and renders the document.
 *
 * The options are passed twice on purpose. {@link ViewerController.load} replaces the controller's
 * options wholesale rather than merging them, so options given only to the mount are discarded on
 * the first load — silently, taking the renderer restriction with them.
 */
export const mountDocument = async (
  container: HTMLElement,
  blob: Blob,
  filename: string,
): Promise<ViewerController> => {
  const controller = mountViewer(container, { options: VIEWER_OPTIONS });
  await controller.load({ file: blob, filename, options: VIEWER_OPTIONS });
  return controller;
};
