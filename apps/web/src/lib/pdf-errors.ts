/**
 * Ist das PDF selbst unlesbar (beschädigt, kein PDF, passwortgeschützt)? Dann hilft kein zweiter Versuch.
 * Alles andere (Netzfehler, Server nicht erreichbar, Datei noch nicht da) ist ein Ladefehler: Erneut versuchen kann helfen.
 * Die Namen stammen von den Ausnahmen aus pdf.js.
 */
export function isCorruptPdfError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'InvalidPDFException' || name === 'FormatError' || name === 'PasswordException';
}
