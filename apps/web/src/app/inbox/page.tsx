import type { Metadata } from 'next';
import { MoodleInbox } from '../../components/MoodleInbox.tsx';

export const metadata: Metadata = { title: 'Inbox' };

/** Inbox (07 §3.11). Bis Phase 2 nur die offenen Dateien aus dem Moodle-Abgleich (F-MDL-04, T1-23) */
export default function InboxPage() {
  return (
    <section aria-labelledby="screen-title">
      <h1 id="screen-title" className="text-xxl font-semibold">
        Inbox
      </h1>
      <div className="mt-6">
        <MoodleInbox />
      </div>
    </section>
  );
}
