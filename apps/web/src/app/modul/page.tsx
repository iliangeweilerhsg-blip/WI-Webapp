import type { Metadata } from 'next';
import { ModulView } from '../../components/ModulView.tsx';

export const metadata: Metadata = { title: 'Modul' };

export default function ModulPage() {
  return <ModulView />;
}
