import type { Metadata } from 'next';
import { ReviewView } from '../../components/rueckblick/ReviewView.tsx';

export const metadata: Metadata = { title: 'Rückblick' };

export default function RueckblickPage() {
  return <ReviewView />;
}
