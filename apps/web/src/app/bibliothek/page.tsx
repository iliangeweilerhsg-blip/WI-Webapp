import type { Metadata } from 'next';
import { PlaceholderScreen } from '../../components/Placeholder.tsx';

export const metadata: Metadata = { title: 'Bibliothek' };

export default function BibliothekPage() {
  return (
    <PlaceholderScreen title="Bibliothek" phase={2}>
      Hier findest du Folien, Konzepte und Notizen aller Module.
    </PlaceholderScreen>
  );
}
