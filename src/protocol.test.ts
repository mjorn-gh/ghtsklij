import { describe, expect, it } from 'vitest';
import {
  HANDSHAKE_TYPE,
  PROTOCOL_VERSION,
  createHandshakeMessage,
  isAllowedDocumentUrl,
  isHandshakeMessage,
  isPreviewCommand,
  isPreviewEvent,
  resolveDisplayFilename,
} from './protocol';

const PRESIGNED =
  'https://example-documents.s3.eu-central-1.amazonaws.com/archive/delivery-note.pdf?X-Amz-Signature=placeholder';

describe('isAllowedDocumentUrl', () => {
  it('isAllowedDocumentUrl_presignedHttpsUrl_accepts', () => {
    expect(isAllowedDocumentUrl(PRESIGNED)).toBe(true);
  });

  it('isAllowedDocumentUrl_loopbackHttpUrl_accepts', () => {
    expect(isAllowedDocumentUrl('http://localhost:5173/sample.pdf')).toBe(true);
    expect(isAllowedDocumentUrl('http://127.0.0.1:5173/sample.pdf')).toBe(true);
  });

  it('isAllowedDocumentUrl_remoteHttpUrl_rejects', () => {
    expect(isAllowedDocumentUrl('http://documents.example.com/a.pdf')).toBe(false);
  });

  it('isAllowedDocumentUrl_scriptBearingScheme_rejects', () => {
    expect(isAllowedDocumentUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedDocumentUrl('data:application/pdf;base64,JVBERi0=')).toBe(false);
    expect(isAllowedDocumentUrl('blob:https://example.com/2b8c')).toBe(false);
    expect(isAllowedDocumentUrl('file:///etc/passwd')).toBe(false);
  });

  it('isAllowedDocumentUrl_embeddedCredentials_rejects', () => {
    expect(isAllowedDocumentUrl('https://user:secret@example.com/a.pdf')).toBe(false);
  });

  it('isAllowedDocumentUrl_malformedInput_rejects', () => {
    expect(isAllowedDocumentUrl('')).toBe(false);
    expect(isAllowedDocumentUrl('not a url')).toBe(false);
  });
});

describe('resolveDisplayFilename', () => {
  it('resolveDisplayFilename_providedName_usesIt', () => {
    expect(resolveDisplayFilename(PRESIGNED, 'delivery-note.pdf')).toBe('delivery-note.pdf');
  });

  it('resolveDisplayFilename_noProvidedName_derivesFromPath', () => {
    expect(resolveDisplayFilename(PRESIGNED)).toBe('delivery-note.pdf');
  });

  // A store may well accept these on upload, so rejecting them here would show `document.pdf` for a
  // document whose real name is perfectly valid.
  it('resolveDisplayFilename_nonAsciiName_keepsIt', () => {
    expect(resolveDisplayFilename(PRESIGNED, 'Lieferschein_Zürich.pdf')).toBe(
      'Lieferschein_Zürich.pdf',
    );
    expect(resolveDisplayFilename(PRESIGNED, 'Facture n°12, Genève & Cie.pdf')).toBe(
      'Facture n°12, Genève & Cie.pdf',
    );
    expect(resolveDisplayFilename(PRESIGNED, '提单.pdf')).toBe('提单.pdf');
  });

  it('resolveDisplayFilename_nameWithPathSegments_keepsOnlyTheLast', () => {
    expect(resolveDisplayFilename(PRESIGNED, 'a/b/delivery-note.pdf')).toBe('delivery-note.pdf');
    expect(resolveDisplayFilename(PRESIGNED, 'C:\\docs\\delivery-note.pdf')).toBe(
      'delivery-note.pdf',
    );
  });

  it('resolveDisplayFilename_controlCharacters_dropsThem', () => {
    expect(resolveDisplayFilename(PRESIGNED, 'delivery\u0000-\u001fnote.pdf')).toBe(
      'delivery-note.pdf',
    );
  });

  // Safe because the name reaches the DOM through textContent, never an HTML sink.
  it('resolveDisplayFilename_markupBearingName_keepsItAsText', () => {
    expect(resolveDisplayFilename(PRESIGNED, '<img src=x onerror=alert(1)>')).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('resolveDisplayFilename_officeAndEmailNames_keepThem', () => {
    expect(resolveDisplayFilename(PRESIGNED, 'Rechnung.xlsx')).toBe('Rechnung.xlsx');
    expect(resolveDisplayFilename(PRESIGNED, 'Frachtbrief.docx')).toBe('Frachtbrief.docx');
    expect(resolveDisplayFilename(PRESIGNED, 'Anfrage.eml')).toBe('Anfrage.eml');
    expect(resolveDisplayFilename(PRESIGNED, 'Anfrage.msg')).toBe('Anfrage.msg');
  });

  // The extension selects the renderer, so a rejected name must not silently become a PDF.
  it('resolveDisplayFilename_rejectedName_keepsTheExtension', () => {
    expect(resolveDisplayFilename(PRESIGNED, `${'a'.repeat(513)}.xlsx`)).toBe('document.xlsx');
    expect(resolveDisplayFilename('https://example.com/report.docx', '   ')).toBe('document.docx');
    expect(resolveDisplayFilename('https://example.com/mail.eml', '\u0000')).toBe('document.eml');
  });

  it('resolveDisplayFilename_relativePathName_fallsBackKeepingTheUrlExtension', () => {
    expect(resolveDisplayFilename('https://example.com/a.xlsx', '.')).toBe('document.xlsx');
    expect(resolveDisplayFilename('https://example.com/a.xlsx', '..')).toBe('document.xlsx');
  });

  // Guessing a renderer for an unknown type would be worse than not rendering it.
  it('resolveDisplayFilename_noExtensionAnywhere_yieldsNoExtension', () => {
    expect(resolveDisplayFilename('https://example.com/', '   ')).toBe('document');
    expect(resolveDisplayFilename('https://example.com/blob', '')).toBe('document');
  });

  it('resolveDisplayFilename_implausibleExtension_isNotTreatedAsOne', () => {
    expect(resolveDisplayFilename('https://example.com/a.thisisnotanextension', '  ')).toBe(
      'document',
    );
  });

  it('resolveDisplayFilename_nameAtTheDmsLengthLimit_keepsIt', () => {
    const atLimit = `${'a'.repeat(508)}.pdf`;
    expect(resolveDisplayFilename(PRESIGNED, atLimit)).toBe(atLimit);
  });
});

describe('message guards', () => {
  it('isHandshakeMessage_currentProtocol_accepts', () => {
    expect(isHandshakeMessage(createHandshakeMessage())).toBe(true);
  });

  it('isHandshakeMessage_foreignOrOutdatedMessage_rejects', () => {
    expect(
      isHandshakeMessage({ type: HANDSHAKE_TYPE, protocolVersion: PROTOCOL_VERSION + 1 }),
    ).toBe(false);
    expect(isHandshakeMessage({ type: 'other', protocolVersion: PROTOCOL_VERSION })).toBe(false);
    expect(isHandshakeMessage(null)).toBe(false);
    expect(isHandshakeMessage('handshake')).toBe(false);
  });

  it('isPreviewCommand_loadCommand_accepts', () => {
    expect(isPreviewCommand({ type: 'load', bytes: new ArrayBuffer(8), filename: 'a.pdf' })).toBe(
      true,
    );
  });

  it('isPreviewCommand_missingOrMistypedFields_rejects', () => {
    expect(isPreviewCommand({ type: 'load' })).toBe(false);
    expect(isPreviewCommand({ type: 'load', bytes: new ArrayBuffer(8) })).toBe(false);
    expect(isPreviewCommand({ type: 'load', filename: 'a.pdf' })).toBe(false);
    // A URL must not be mistaken for a document any more.
    expect(isPreviewCommand({ type: 'load', bytes: PRESIGNED, filename: 'a.pdf' })).toBe(false);
    expect(isPreviewCommand({ type: 'unload', bytes: new ArrayBuffer(8), filename: 'a.pdf' })).toBe(
      false,
    );
  });

  it('isPreviewEvent_knownEvents_accepts', () => {
    expect(isPreviewEvent({ type: 'ready', protocolVersion: PROTOCOL_VERSION })).toBe(true);
    expect(isPreviewEvent({ type: 'rendered', filename: 'a.pdf' })).toBe(true);
    expect(isPreviewEvent({ type: 'error', message: 'boom' })).toBe(true);
  });

  it('isPreviewEvent_unknownEvent_rejects', () => {
    expect(isPreviewEvent({ type: 'progress' })).toBe(false);
    expect(isPreviewEvent(undefined)).toBe(false);
  });
});
