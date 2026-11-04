import type { Metadata } from 'next';
import { PlaceholderScreen } from '../../components/Placeholder.tsx';

export const metadata: Metadata = { title: 'Inbox' };

export default function InboxPage() {
  return (
    <PlaceholderScreen title="Inbox" phase={2}>
      Hier prüfst du Vorschläge aus deinen Vorlesungen: annehmen oder verwerfen.
    </PlaceholderScreen>
  );
}
