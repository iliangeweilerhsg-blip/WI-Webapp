import type { Metadata } from 'next';
import { CalendarView } from '../../components/CalendarView.tsx';

export const metadata: Metadata = { title: 'Kalender' };

export default function KalenderPage() {
  return <CalendarView />;
}
