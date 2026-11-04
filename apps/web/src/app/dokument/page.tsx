import type { Metadata } from 'next';
import { DocumentView } from '../../components/DocumentView.tsx';

export const metadata: Metadata = { title: 'Dokument' };

export default function DokumentPage() {
  return <DocumentView />;
}
