import type { Metadata } from 'next';
import { LibraryView } from '../../components/concepts/LibraryView.tsx';

export const metadata: Metadata = { title: 'Bibliothek' };

/** Bibliothek (VERTRAEGE §20.10): Konzeptliste je Modul, mit `?konzept=<id>` die Konzeptansicht (F-BIB-02) */
export default function BibliothekPage() {
  return <LibraryView />;
}
