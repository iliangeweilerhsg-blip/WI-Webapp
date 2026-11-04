import type { Metadata } from 'next';
import { PlaceholderScreen } from '../../components/Placeholder.tsx';

export const metadata: Metadata = { title: 'Planer' };

export default function PlanerPage() {
  return (
    <PlaceholderScreen title="Planer" phase={4}>
      Hier siehst du deine Woche mit Terminen und Lernblöcken.
    </PlaceholderScreen>
  );
}
