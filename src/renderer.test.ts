import { beforeEach, describe, expect, it, vi } from 'vitest';

const load = vi.fn<(options: unknown) => Promise<void>>(() => Promise.resolve());
const mountViewer = vi.fn((_container: HTMLElement, _options: unknown) => ({ load }));
// Shared with a hoisted mock factory, so it has to be hoisted too. The registration happens once,
// when the module is imported, so it is recorded in a plain array — a spy's call log is reset
// between tests and would have forgotten it by the time the assertion runs.
const { registerRtfLoader, registeredRtfLoaders } = vi.hoisted(() => {
  const registered: unknown[] = [];
  return {
    registeredRtfLoaders: registered,
    registerRtfLoader: (loader: unknown) => {
      registered.push(loader);
    },
  };
});

vi.mock('@file-viewer/web', () => ({ mountViewer }));
vi.mock('@file-viewer/renderer-pdf', () => ({ default: { id: 'pdf-renderer-stub' } }));
vi.mock('@file-viewer/renderer-word', () => ({
  default: { id: 'word-renderer-stub' },
  registerFileViewerRtfLoader: registerRtfLoader,
}));
vi.mock('@file-viewer/renderer-spreadsheet', () => ({
  default: { id: 'spreadsheet-renderer-stub' },
}));
vi.mock('@file-viewer/renderer-email', () => ({ default: { id: 'email-renderer-stub' } }));
vi.mock('@file-viewer/renderer-image', () => ({ default: { id: 'image-renderer-stub' } }));

const { VIEWER_OPTIONS, mountDocument } = await import('./renderer');

const container = {} as HTMLElement;

const mountArguments = () => mountViewer.mock.calls[0]?.[1] as { options?: unknown } | undefined;
const loadArguments = () => load.mock.calls[0]?.[0] as { options?: unknown } | undefined;

describe('mountDocument', () => {
  beforeEach(() => {
    mountViewer.mockClear();
    load.mockClear();
  });

  /**
   * `load` replaces the controller's options instead of merging them, so options passed only to
   * the mount are discarded on the first load. That failed silently once: the document rendered
   * correctly while every option — including the renderer restriction — had reverted to its
   * default.
   */
  it('mountDocument_always_passesTheSameOptionsToMountAndLoad', async () => {
    await mountDocument(container, new Blob([new Uint8Array([1, 2, 3])]), 'delivery-note.pdf');

    expect(mountArguments()?.options).toBe(VIEWER_OPTIONS);
    expect(loadArguments()?.options).toBe(VIEWER_OPTIONS);
  });

  it('mountDocument_always_loadsTheBlobUnderItsFilename', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);

    await mountDocument(container, blob, 'delivery-note.pdf');

    expect(loadArguments()).toEqual({
      file: blob,
      filename: 'delivery-note.pdf',
      options: VIEWER_OPTIONS,
    });
  });

  /** A URL would make the sandboxed frame fetch the document itself. It must only ever get bytes. */
  it('mountDocument_always_passesNoUrl', async () => {
    await mountDocument(container, new Blob([]), 'delivery-note.pdf');

    expect(loadArguments()).not.toHaveProperty('url');
    expect(mountArguments()).not.toHaveProperty('url');
  });
});

describe('RTF capability', () => {
  /**
   * `.msg` messages commonly carry an RTF-only body. Without a registered loader the email
   * renderer silently degrades to plain text and a notice, which reads like a broken preview.
   */
  it('renderer_whenImported_registersAnRtfLoader', () => {
    expect(registeredRtfLoaders).toHaveLength(1);
    expect(registeredRtfLoaders[0]).toBeTypeOf('function');
  });
});

describe('VIEWER_OPTIONS', () => {
  /**
   * The registry restriction is the reason an unexpected content type cannot reach a renderer
   * nobody reviewed. It is worth pinning by value rather than trusting the option was accepted.
   */
  it('VIEWER_OPTIONS_always_startsFromAnEmptyRegistry', () => {
    expect(VIEWER_OPTIONS.rendererMode).toBe('replace');
    expect(VIEWER_OPTIONS.builtinRenderers).toBe('none');
    expect(VIEWER_OPTIONS.autoRenderers).toBe(false);
  });

  /**
   * Every renderer here was audited before it was added. A renderer appearing without that review
   * is the failure this pins — the list is the review record, not an implementation detail.
   */
  it('VIEWER_OPTIONS_always_reachesOnlyTheReviewedRenderers', () => {
    expect(VIEWER_OPTIONS.renderers).toEqual([
      { id: 'pdf-renderer-stub' },
      { id: 'word-renderer-stub' },
      { id: 'spreadsheet-renderer-stub' },
      { id: 'email-renderer-stub' },
      { id: 'image-renderer-stub' },
    ]);
  });

  /**
   * The shell toolbar carries download, print and export, which the sandbox blocks, and which
   * belong to the host because it holds the URL and the session.
   */
  it('VIEWER_OPTIONS_always_hidesTheShellToolbar', () => {
    expect(VIEWER_OPTIONS.toolbar).toBe(false);
  });

  it('VIEWER_OPTIONS_always_collapsesTheOutlinePane', () => {
    expect(VIEWER_OPTIONS.pdf).toEqual({ defaultNavigationVisible: false });
  });
});
