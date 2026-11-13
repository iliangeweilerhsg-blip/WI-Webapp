import type { Metadata } from 'next';
import { LearnView } from '../../components/learn/LearnView.tsx';

export const metadata: Metadata = { title: 'Lernen' };

/** Lernen (VERTRAEGE §21.10): Heute wiederholen mit Zeitbudget und FSRS */
export default function LernenPage() {
  return <LearnView />;
}
