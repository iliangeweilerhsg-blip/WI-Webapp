import type { Metadata } from 'next';
import { HeuteView } from '../components/HeuteView.tsx';

export const metadata: Metadata = { title: { absolute: 'Heute · Studien-Gehirn' } };

export default function HeutePage() {
  return <HeuteView />;
}
