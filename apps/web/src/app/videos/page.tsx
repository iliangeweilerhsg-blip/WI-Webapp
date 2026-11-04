import type { Metadata } from 'next';
import { PlaceholderScreen } from '../../components/Placeholder.tsx';

export const metadata: Metadata = { title: 'Videos' };

export default function VideosPage() {
  return (
    <PlaceholderScreen title="Videos" phase={5}>
      Hier erscheinen kurze Erklärvideos zu deinen Konzepten.
    </PlaceholderScreen>
  );
}
