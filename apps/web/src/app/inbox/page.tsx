import type { Metadata } from 'next';
import { SuggestionInbox } from '../../components/inbox/SuggestionInbox.tsx';
import { MoodleInbox } from '../../components/MoodleInbox.tsx';

export const metadata: Metadata = { title: 'Inbox' };

/**
 * Inbox (07 §3.11): oben die Vorschläge aus den Vorlesungen (VERTRAEGE §20.10, F-NAC-06), darunter wie bisher die
 * offenen Dateien aus dem Moodle-Abgleich (F-MDL-04, T1-23).
 */
export default function InboxPage() {
  return (
    <section aria-labelledby="screen-title">
      <h1 id="screen-title" tabIndex={-1} className="text-xxl font-semibold focus:outline-none">
        Inbox
      </h1>
      <div className="mt-6">
        <SuggestionInbox />
      </div>
      <section aria-labelledby="inbox-moodle-title" className="mt-10">
        <h2 id="inbox-moodle-title" className="text-lg font-medium">
          Moodle-Dateien
        </h2>
        <div className="mt-3">
          <MoodleInbox />
        </div>
      </section>
    </section>
  );
}
