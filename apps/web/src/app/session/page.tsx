import type { Metadata } from 'next';
import { SessionView } from '../../components/dashboard/SessionView.tsx';

export const metadata: Metadata = { title: 'Session' };

export default function SessionPage() {
  return <SessionView />;
}
