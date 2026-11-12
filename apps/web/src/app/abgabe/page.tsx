import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AbgabeView } from '../../components/moodle/AbgabeView.tsx';

export const metadata: Metadata = { title: 'Abgabe' };

export default function AbgabePage() {
  return (
    <Suspense fallback={null}>
      <AbgabeView />
    </Suspense>
  );
}
