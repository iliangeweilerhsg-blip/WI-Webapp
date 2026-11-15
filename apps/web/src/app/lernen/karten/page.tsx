import type { Metadata } from 'next';
import { CardManager } from '../../../components/learn/CardManager.tsx';

export const metadata: Metadata = { title: 'Karten verwalten' };

/** Karten verwalten (VERTRAEGE §21.14, F-LRN-16): Liste mit Filtern, Suche und Massenaktionen */
export default function KartenPage() {
  return <CardManager />;
}
