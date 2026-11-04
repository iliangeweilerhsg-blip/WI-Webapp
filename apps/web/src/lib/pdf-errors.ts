/**
 * Warum ließ sich ein PDF nicht öffnen? Die Namen stammen von den Ausnahmen aus pdf.js (in 6.4.299 gemessen):
 * - `InvalidPDFException`: kaputt, leer oder gar kein PDF (z. B. eine HTML-Antwort)
 * - `PasswordException`: passwortgeschützt
 * - `ResponseException` (z. B. 404) und `UnknownErrorException` (Netz): Ladefehler, ein neuer Versuch kann helfen
 * `invalid` und `password` sind endgültig, nur `load` ist behebbar. Grenzfall: Meldet der Core den Einlese-Zustand
 * `fehler`, zeigt die Anzeige „beschädigt“ auch bei einem gleichzeitigen Netzfehler (der Core hält die Datei dann ohnehin für kaputt).
 */
export type PdfFailure = 'invalid' | 'password' | 'load';

export function classifyPdfError(error: unknown): PdfFailure {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'PasswordException') return 'password';
  if (name === 'InvalidPDFException') return 'invalid';
  return 'load';
}
