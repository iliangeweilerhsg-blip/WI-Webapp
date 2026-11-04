import type { Metadata } from 'next';
import { SettingsView } from '../../components/SettingsView.tsx';

export const metadata: Metadata = { title: 'Einstellungen' };

export default function EinstellungenPage() {
  return <SettingsView />;
}
