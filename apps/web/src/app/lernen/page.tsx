import type { Metadata } from 'next';
import { PlaceholderScreen } from '../../components/Placeholder.tsx';

export const metadata: Metadata = { title: 'Lernen' };

export default function LernenPage() {
  return (
    <PlaceholderScreen title="Lernen" phase={3}>
      Hier startest du Wiederholungen und Lerneinheiten, jeweils mit Dauer.
    </PlaceholderScreen>
  );
}
