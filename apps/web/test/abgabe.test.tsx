// T1-24 PR 4: Seite „Abgabe“ und <MoodleActionButton> gegen gemockte Core-Antworten. Alle Namen sind erfunden.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.TZ = 'Europe/Zurich';
});

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const search = vi.hoisted(() => ({ value: 'aufgabe=42&modul=0190f6a2-0000-7000-8000-0000000000a1' }));
const session = vi.hoisted(() => ({ active: false as boolean | undefined }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/abgabe',
  useSearchParams: () => new URLSearchParams(search.value),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../src/lib/sessions.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/sessions.ts')>()),
  // `undefined` = noch unbekannt (Abruf läuft oder scheiterte)
  useActiveSession: () => ({
    data: session.active === undefined ? undefined : session.active ? { id: 's1' } : null,
  }),
}));

import { AbgabeView } from '../src/components/moodle/AbgabeView.tsx';
import { MoodleActionButton } from '../src/components/moodle/MoodleActionButton.tsx';
import { MoodleDeadlines } from '../src/components/MoodleDeadlines.tsx';
import { QueryProvider } from '../src/lib/query.tsx';

const NOW = '2026-11-05T12:00:00Z';
const TOKEN = 'token-aaaaaaaaaaaaaaaa';

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
}

interface Script {
  /** Antworten auf `execute`, der Reihe nach */
  execute: Array<() => Response | Promise<Response>>;
  preview: Array<() => Response | Promise<Response>>;
  submission: Record<string, unknown>;
  assignment: Record<string, unknown>;
  catalog: Array<{ id: string; label: string; available: boolean }>;
  deadlines: unknown[];
  status: Record<string, unknown>;
  submissionError: Response | null;
  calls: Call[];
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const apiError = (status: number, code: string, details: Record<string, unknown> = {}) =>
  json({ error: { code, message: `${code} (Test)`, details } }, status);

function previewBody(over: Record<string, unknown> = {}) {
  return {
    action_id: 'assign.submit',
    risk: 'endgueltig',
    needs_confirmation: true,
    summary: 'Abgabe „Blatt 3“ in „Beispielkurs“ endgültig einreichen: loesung.pdf (1,2 MB).',
    warnings: ['Gruppenabgabe: Das gilt für die ganze Gruppe.'],
    // Form wie im Core (`assign.*`, #303)
    details: {
      files: [{ name: 'loesung.pdf', size_bytes: 1_200_000 }],
      text_preview: '<b>kein HTML</b>',
      requires_statement: false,
    },
    confirmation_token: TOKEN,
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    ...over,
  };
}
const resultBody = {
  action_id: 'assign.submit',
  summary: 'Eingereicht.',
  result: { state: 'eingereicht', last_modified_at: NOW, verified: true, warnings: [] },
};

function makeScript(): Script {
  return {
    execute: [],
    preview: [],
    submission: {
      assignment_id: 42,
      state: 'entwurf',
      graded: false,
      grade: null,
      feedback_html: null,
      last_modified_at: NOW,
      can_edit: true,
      can_submit: true,
      files: [
        {
          ref: '/1/a.pdf',
          filename: 'loesung.pdf',
          mime_type: 'application/pdf',
          size_bytes: 1_200_000,
          modified_at: NOW,
        },
      ],
      online_text_html: null,
    },
    assignment: {
      moodle_id: 42,
      cmid: 7,
      course_id: 901,
      name: 'Blatt 3',
      due_at: '2026-11-12T22:59:00Z',
      cutoff_at: null,
      opens_at: null,
      intro_html: null,
      intro_files: [],
      submission_types: ['file'],
      requires_statement: false,
      requires_submit: true,
    },
    catalog: [
      { id: 'assign.save_draft', label: 'Als Entwurf speichern', available: true },
      { id: 'assign.submit', label: 'Abgabe einreichen', available: true },
    ],
    deadlines: [],
    status: {
      state: 'ok',
      site_url: 'https://moodle.example.org',
      site_name: 'Beispiel-Moodle',
      user_fullname: 'Erika Beispiel',
      token_valid_until: '2027-01-31',
      checked_at: NOW,
    },
    submissionError: null,
    calls: [],
  };
}

let script: Script;

function install() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname.replace(/^\/api\/v1/, '');
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      script.calls.push({ method, path, body, headers: (init?.headers ?? {}) as Record<string, string> });
      if (path === '/moodle/status') return json(script.status);
      if (path === '/moodle/actions') return json({ items: script.catalog.map(infoOf) });
      if (path === '/moodle/assignments') return json({ items: [script.assignment] });
      if (path === '/moodle/assignments/42/submission')
        return script.submissionError ?? json(script.submission);
      if (path === '/moodle/synced-deadlines') return json({ items: script.deadlines });
      if (path === '/moodle/uploads' && method === 'POST') {
        const file = (init?.body as FormData).get('file') as File;
        if (file.name === 'riesig.zip') return apiError(413, 'file_too_large', {});
        return json(
          {
            upload_id: '0190f6a2-0000-7000-8000-000000000aa1',
            filename: file.name,
            size_bytes: file.size,
            expires_at: NOW,
          },
          201,
        );
      }
      if (path.startsWith('/moodle/uploads/') && method === 'DELETE')
        return new Response(null, { status: 204 });
      if (path.endsWith('/preview')) {
        const next = script.preview.shift();
        return next ? next() : json(previewBody());
      }
      if (path.endsWith('/execute')) {
        const next = script.execute.shift();
        return next ? next() : json(resultBody);
      }
      return apiError(404, 'not_found');
    }),
  );
}

function infoOf(item: { id: string; label: string; available: boolean }) {
  return {
    ...item,
    description: 'x',
    risk: item.id === 'assign.submit' ? 'endgueltig' : 'aenderbar',
    needs_confirmation: item.id === 'assign.submit',
  };
}

const callsTo = (suffix: string) => script.calls.filter((c) => c.path.endsWith(suffix));

function Button(props: Partial<React.ComponentProps<typeof MoodleActionButton>> = {}) {
  return (
    <QueryProvider>
      <MoodleActionButton
        action="assign.submit"
        params={{ assignment_id: 42, accept_statement: true }}
        label="Endgültig einreichen"
        confirmLabel="Einreichen"
        {...props}
      />
    </QueryProvider>
  );
}

beforeEach(() => {
  script = makeScript();
  session.active = false;
  search.value = 'aufgabe=42&modul=0190f6a2-0000-7000-8000-0000000000a1';
  install();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MoodleActionButton', () => {
  it('fragt zuerst, Abbrechen ist der Standard, und führt erst nach „Einreichen“ mit Code aus', async () => {
    const user = userEvent.setup();
    render(<Button />);
    await user.click(screen.getByRole('button', { name: 'Endgültig einreichen' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/endgültig einreichen: loesung.pdf/)).toBeInTheDocument();
    expect(within(dialog).getByText('Gruppenabgabe: Das gilt für die ganze Gruppe.')).toBeInTheDocument();
    expect(within(dialog).getByText('loesung.pdf')).toBeInTheDocument();
    // Fremder Text bleibt Text
    expect(within(dialog).getByText('<b>kein HTML</b>')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toHaveFocus();
    expect(callsTo('/execute')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Einreichen' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Eingereicht.');
    expect(callsTo('/execute')).toHaveLength(1);
    expect(callsTo('/execute')[0]?.body).toEqual({
      params: { assignment_id: 42, accept_statement: true },
      confirmation_token: TOKEN,
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('führt ohne Bestätigung direkt aus', async () => {
    script.preview.push(() =>
      json(previewBody({ needs_confirmation: false, confirmation_token: null, expires_at: null })),
    );
    const user = userEvent.setup();
    render(<Button />);
    await user.click(screen.getByRole('button', { name: 'Endgültig einreichen' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Eingereicht.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(callsTo('/execute')[0]?.body).toEqual({ params: { assignment_id: 42, accept_statement: true } });
  });

  it('Escape bricht ab, nichts wird ausgeführt', async () => {
    const user = userEvent.setup();
    render(<Button />);
    await user.click(screen.getByRole('button', { name: 'Endgültig einreichen' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(callsTo('/execute')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Endgültig einreichen' })).toHaveFocus();
  });

  it('doppelter Klick schickt nur eine Vorschau, doppeltes Bestätigen nur ein Ausführen', async () => {
    const user = userEvent.setup();
    render(<Button />);
    const open = screen.getByRole('button', { name: 'Endgültig einreichen' });
    fireEvent.click(open);
    fireEvent.click(open);
    const dialog = await screen.findByRole('dialog');
    expect(callsTo('/preview')).toHaveLength(1);
    let release: () => void = () => {};
    script.execute.push(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(json(resultBody));
        }),
    );
    const confirmButton = within(dialog).getByRole('button', { name: 'Einreichen' });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    await waitFor(() => expect(callsTo('/execute')).toHaveLength(1));
    await act(async () => release());
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(callsTo('/execute')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Endgültig einreichen' }));
  });

  it('stand_geaendert holt eine neue Vorschau und zeigt die Rückfrage neu, ohne selbst auszuführen', async () => {
    script.execute.push(() => apiError(409, 'moodle_confirmation_invalid', { reason: 'stand_geaendert' }));
    script.preview.push(() => json(previewBody()));
    script.preview.push(() => json(previewBody({ confirmation_token: 'token-bbbbbbbbbbbbbbbb' })));
    const user = userEvent.setup();
    render(<Button />);
    await user.click(screen.getByRole('button', { name: 'Endgültig einreichen' }));
    await user.click(
      await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Einreichen' }),
    );
    expect(
      await screen.findByText('Der Entwurf hat sich geändert. Bitte prüfe ihn noch einmal.'),
    ).toBeInTheDocument();
    expect(callsTo('/preview')).toHaveLength(2);
    expect(callsTo('/execute')).toHaveLength(1);
    // Neuer Versuch mit neuem Code und frischem Idempotency-Key
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Einreichen' }));
    await waitFor(() => expect(callsTo('/execute')).toHaveLength(2));
    expect(callsTo('/execute')[1]?.body?.confirmation_token).toBe('token-bbbbbbbbbbbbbbbb');
    const keys = callsTo('/execute').map((c) => c.headers['Idempotency-Key']);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('nach stand_geaendert liegt der Fokus wieder auf „Abbrechen“: ein zweites Enter führt die neue Rückfrage nicht aus', async () => {
    script.execute.push(() => apiError(409, 'moodle_confirmation_invalid', { reason: 'stand_geaendert' }));
    script.preview.push(() => json(previewBody()));
    script.preview.push(() => json(previewBody({ confirmation_token: 'token-bbbbbbbbbbbbbbbb' })));
    const user = userEvent.setup();
    render(<Button />);
    await user.click(screen.getByRole('button', { name: 'Endgültig einreichen' }));
    const dialog = await screen.findByRole('dialog');
    within(dialog).getByRole('button', { name: 'Einreichen' }).focus();
    await user.keyboard('{Enter}');
    expect(await within(dialog).findByText(/Der Entwurf hat sich geändert/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(callsTo('/execute')).toHaveLength(1);
  });

  it('während des Ausführens lässt sich nichts mehr abbrechen, das Ergebnis steht ehrlich da', async () => {
    let release!: () => void;
    script.execute.push(
      () => new Promise<Response>((resolve) => (release = () => resolve(json(resultBody)))),
    );
    const user = userEvent.setup();
    render(<Button />);
    await user.click(screen.getByRole('button', { name: 'Endgültig einreichen' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Einreichen' }));
    await waitFor(() => expect(callsTo('/execute')).toHaveLength(1));
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Abbrechen' }), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => release());
    expect(await screen.findByRole('status')).toHaveTextContent('Eingereicht.');
  });

  it('moodle_action_busy: Rückfrage bleibt mit ruhigem Hinweis, ein neuer Versuch bekommt einen neuen Idempotency-Key', async () => {
    script.execute.push(() => apiError(409, 'moodle_action_busy'));
    const user = userEvent.setup();
    render(<Button />);
    await user.click(screen.getByRole('button', { name: 'Endgültig einreichen' }));
    await user.click(
      await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Einreichen' }),
    );
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText(/läuft gerade eine andere Aktion/)).toBeInTheDocument();
    expect(callsTo('/execute')).toHaveLength(1);
    // Nichts von selbst: erst der zweite Klick schickt wieder
    await user.click(within(dialog).getByRole('button', { name: 'Einreichen' }));
    await screen.findByRole('status');
    expect(callsTo('/preview')).toHaveLength(1);
    const executes = callsTo('/execute');
    expect(executes.map((c) => c.body?.confirmation_token)).toEqual([TOKEN, TOKEN]);
    const keys = executes.map((c) => c.headers['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('moodle_confirmation_required ohne Code: neue Vorschau, Rückfrage, nie selbst ausführen', async () => {
    script.preview.push(() =>
      json(previewBody({ needs_confirmation: false, confirmation_token: null, expires_at: null })),
    );
    script.execute.push(() => apiError(409, 'moodle_confirmation_required'));
    const user = userEvent.setup();
    render(<Button />);
    await user.click(screen.getByRole('button', { name: 'Endgültig einreichen' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/verlangt dafür jetzt eine Bestätigung/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toHaveFocus();
    expect(callsTo('/preview')).toHaveLength(2);
    expect(callsTo('/execute')).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Einreichen' }));
    await screen.findByRole('status');
    expect(callsTo('/execute')[1]?.body?.confirmation_token).toBe(TOKEN);
  });

  it('Vorschau verlangt Bestätigung, liefert aber keinen Code: nichts ausführen', async () => {
    script.preview.push(() => json(previewBody({ confirmation_token: null })));
    const user = userEvent.setup();
    render(<Button />);
    await user.click(screen.getByRole('button', { name: 'Endgültig einreichen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Die Bestätigung fehlt');
    expect(callsTo('/execute')).toHaveLength(0);
  });

  it('zeigt Abweichungen aus result.warnings und ein nicht nachgeprüftes Ergebnis ehrlich an', async () => {
    script.execute.push(() =>
      json({
        action_id: 'assign.save_draft',
        summary: 'Entwurf gespeichert, aber mit Abweichungen.',
        result: {
          state: 'entwurf',
          files: [{ name: 'a.pdf', size_bytes: 1 }],
          last_modified_at: NOW,
          verified: true,
          warnings: ['Nicht im Entwurf gefunden: b.pdf.'],
        },
      }),
    );
    script.execute.push(() =>
      json({
        action_id: 'assign.save_draft',
        summary:
          'Entwurf gespeichert. Der neue Stand konnte nicht gelesen werden, bitte prüfe ihn in Moodle.',
        result: { state: null, files: null, last_modified_at: null, verified: false, warnings: [] },
      }),
    );
    const user = userEvent.setup();
    render(<Button />);
    await user.click(screen.getByRole('button', { name: 'Endgültig einreichen' }));
    await user.click(
      await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Einreichen' }),
    );
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Entwurf gespeichert, aber mit Abweichungen.');
    expect(within(status).getByText('Nicht im Entwurf gefunden: b.pdf.')).toBeInTheDocument();
    expect(status).not.toHaveTextContent('nicht nachprüfen');
    expect(status).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Endgültig einreichen' }));
    await user.click(
      await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Einreichen' }),
    );
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('nicht nachprüfen'));
    expect(screen.getByRole('status')).not.toHaveTextContent('Abweichungen');
  });

  it('Erklärung: Text und leeres Häkchen in der Rückfrage, Bestätigen erst mit Häkchen', async () => {
    script.preview.push(() =>
      json(
        previewBody({
          details: {
            files: [{ name: 'loesung.pdf', size_bytes: 1_200_000 }],
            requires_statement: true,
            statement_text: 'Ich habe diese Arbeit selbst verfasst.',
          },
        }),
      ),
    );
    script.preview.push(() =>
      json(
        previewBody({
          confirmation_token: 'token-bbbbbbbbbbbbbbbb',
          details: { requires_statement: true, statement_text: 'Ich habe diese Arbeit selbst verfasst.' },
        }),
      ),
    );
    script.execute.push(() => apiError(409, 'moodle_confirmation_invalid', { reason: 'stand_geaendert' }));
    const user = userEvent.setup();
    render(<Button />);
    await user.click(screen.getByRole('button', { name: 'Endgültig einreichen' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Ich habe diese Arbeit selbst verfasst.')).toBeInTheDocument();
    const box = within(dialog).getByRole('checkbox', { name: /Erklärung gelesen/ });
    expect(box).not.toBeChecked();
    const go = within(dialog).getByRole('button', { name: 'Einreichen' });
    expect(go).toBeDisabled();
    fireEvent.click(go);
    expect(callsTo('/execute')).toHaveLength(0);
    await user.click(box);
    expect(go).toBeEnabled();
    await user.click(go);
    // Neue Vorschau nach `stand_geaendert`: das Häkchen steht wieder leer da
    expect(await within(dialog).findByText(/Der Entwurf hat sich geändert/)).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox')).not.toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Einreichen' })).toBeDisabled();
    expect(callsTo('/execute')).toHaveLength(1);
  });

  it('501: ehrlicher Hinweis „noch nicht freigeschaltet“, Knopf aus', async () => {
    script.preview.push(() => apiError(501, 'moodle_action_not_implemented'));
    const user = userEvent.setup();
    render(<Button />);
    await user.click(screen.getByRole('button', { name: 'Endgültig einreichen' }));
    expect(await screen.findByText('Das ist noch nicht freigeschaltet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Endgültig einreichen' })).toBeDisabled();
  });

  it('moodle_error ohne outcome_unknown: Moodle meldet den Fehler, nicht der Core', async () => {
    script.execute.push(() => apiError(502, 'moodle_error', { moodle_errorcode: 'warning' }));
    const user = userEvent.setup();
    render(<Button />);
    await user.click(screen.getByRole('button', { name: 'Endgültig einreichen' }));
    await user.click(
      await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Einreichen' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Moodle hat einen Fehler gemeldet.');
    expect(callsTo('/execute')).toHaveLength(1);
  });

  it('outcome_unknown: kein Wiederholen, Hinweis und onUncertain', async () => {
    script.execute.push(() => apiError(502, 'moodle_unreachable', { outcome_unknown: true }));
    const onUncertain = vi.fn();
    const user = userEvent.setup();
    render(<Button onUncertain={onUncertain} />);
    await user.click(screen.getByRole('button', { name: 'Endgültig einreichen' }));
    await user.click(
      await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Einreichen' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Unklar, ob Moodle es übernommen hat');
    expect(onUncertain).toHaveBeenCalledOnce();
    expect(callsTo('/execute')).toHaveLength(1);
  });

  it('in einer laufenden Session gibt es keinen Dialog: die Rückfrage steht in der Seite', async () => {
    session.active = true;
    const user = userEvent.setup();
    render(<Button />);
    await user.click(screen.getByRole('button', { name: 'Endgültig einreichen' }));
    const region = await screen.findByRole('region');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument();
    expect(within(region).getByText(/endgültig einreichen: loesung.pdf/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(callsTo('/execute')).toHaveLength(0);
  });

  it('solange unklar ist, ob eine Session läuft, gibt es keinen Dialog', async () => {
    session.active = undefined;
    const user = userEvent.setup();
    render(<Button />);
    await user.click(screen.getByRole('button', { name: 'Endgültig einreichen' }));
    expect(await screen.findByRole('region')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Session startet bei offenem Dialog: Dialog verschwindet, Rückfrage steht in der Seite, Code bleibt', async () => {
    const user = userEvent.setup();
    const view = render(<Button />);
    await user.click(screen.getByRole('button', { name: 'Endgültig einreichen' }));
    await screen.findByRole('dialog');
    session.active = true;
    view.rerender(<Button />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(within(screen.getByRole('region')).getByRole('button', { name: 'Einreichen' }));
    await screen.findByRole('status');
    expect(callsTo('/execute')[0]?.body?.confirmation_token).toBe(TOKEN);
    expect(callsTo('/preview')).toHaveLength(1);
  });
});

describe('Seite „Abgabe“', () => {
  it('zeigt Aufgabe, Stand und Dateien aus Moodle', async () => {
    render(
      <QueryProvider>
        <AbgabeView />
      </QueryProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Blatt 3', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText(/Entwurf gespeichert, noch nicht eingereicht/)).toBeInTheDocument();
    expect(screen.getAllByText(/loesung\.pdf/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'In Moodle öffnen' })).toHaveAttribute(
      'href',
      'https://moodle.example.org/mod/assign/view.php?id=7',
    );
  });

  it('lädt Dateien sofort hoch, speichert den Entwurf mit upload_ids und räumt danach auf', async () => {
    script.preview.push(() =>
      json(
        previewBody({
          action_id: 'assign.save_draft',
          risk: 'aenderbar',
          needs_confirmation: false,
          confirmation_token: null,
          expires_at: null,
          summary: '1 Datei als Entwurf speichern.',
        }),
      ),
    );
    script.execute.push(() =>
      json({ action_id: 'assign.save_draft', summary: 'Entwurf gespeichert.', result: {} }),
    );
    const user = userEvent.setup();
    const { container } = render(
      <QueryProvider>
        <AbgabeView />
      </QueryProvider>,
    );
    const save = await screen.findByRole('button', { name: 'Als Entwurf speichern' });
    expect(save).toBeDisabled();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['x'], 'blatt3.pdf', { type: 'application/pdf' }));
    expect(await screen.findByRole('button', { name: 'blatt3.pdf entfernen' })).toBeInTheDocument();
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);
    expect(await screen.findByText('Entwurf gespeichert.')).toBeInTheDocument();
    expect(callsTo('/execute')[0]?.body).toEqual({
      params: { assignment_id: 42, upload_ids: ['0190f6a2-0000-7000-8000-000000000aa1'] },
    });
    expect(screen.queryByRole('button', { name: 'blatt3.pdf entfernen' })).not.toBeInTheDocument();
  });

  it('„Entfernen“ ruft DELETE auf', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <QueryProvider>
        <AbgabeView />
      </QueryProvider>,
    );
    await screen.findByRole('button', { name: 'Als Entwurf speichern' });
    await user.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['x'], 'a.pdf', { type: 'application/pdf' }),
    );
    await user.click(await screen.findByRole('button', { name: 'a.pdf entfernen' }));
    await waitFor(() =>
      expect(script.calls.some((c) => c.method === 'DELETE' && c.path.startsWith('/moodle/uploads/'))).toBe(
        true,
      ),
    );
    await waitFor(() => expect(screen.queryByText('a.pdf')).not.toBeInTheDocument());
  });

  it('Upload zu groß zeigt die Meldung des Core', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <QueryProvider>
        <AbgabeView />
      </QueryProvider>,
    );
    await screen.findByRole('button', { name: 'Als Entwurf speichern' });
    await user.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['x'], 'riesig.zip', { type: 'application/zip' }),
    );
    expect(await screen.findByText(/file_too_large|Test/)).toBeInTheDocument();
  });

  it('verlangt die Aufgabe eine Erklärung, steht das Häkchen leer in der Rückfrage, nicht vorab in der Seite', async () => {
    script.assignment = { ...script.assignment, requires_statement: true };
    const user = userEvent.setup();
    render(
      <QueryProvider>
        <AbgabeView />
      </QueryProvider>,
    );
    const submit = await screen.findByRole('button', { name: 'Endgültig einreichen' });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await user.click(submit);
    const dialog = await screen.findByRole('dialog');
    const box = within(dialog).getByRole('checkbox');
    expect(box).not.toBeChecked();
    const go = within(dialog).getByRole('button', { name: 'Endgültig einreichen' });
    expect(go).toBeDisabled();
    await user.click(box);
    await user.click(go);
    await screen.findByText('Eingereicht.');
    expect(callsTo('/preview')[0]?.body).toEqual({ params: { assignment_id: 42, accept_statement: true } });
    expect(callsTo('/execute')[0]?.body).toEqual({
      params: { assignment_id: 42, accept_statement: true },
      confirmation_token: TOKEN,
    });
  });

  it('ohne Erklärung kein Häkchen, accept_statement bleibt false', async () => {
    const user = userEvent.setup();
    render(
      <QueryProvider>
        <AbgabeView />
      </QueryProvider>,
    );
    const submit = await screen.findByRole('button', { name: 'Endgültig einreichen' });
    await waitFor(() => expect(screen.getByRole('link', { name: 'In Moodle öffnen' })).toBeInTheDocument());
    await user.click(submit);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(callsTo('/preview')[0]?.body).toEqual({ params: { assignment_id: 42, accept_statement: false } });
  });

  it('Dateiauswahl nennt nur die Typen, die der Core annimmt', async () => {
    const { container } = render(
      <QueryProvider>
        <AbgabeView />
      </QueryProvider>,
    );
    await screen.findByRole('button', { name: 'Als Entwurf speichern' });
    expect(container.querySelector('input[type="file"]')).toHaveAttribute(
      'accept',
      '.pdf,.png,.jpg,.jpeg,.zip,.txt,.md,.csv',
    );
  });

  it('ohne Entwurf ist Einreichen aus; schon eingereicht sperrt auch das Wählen', async () => {
    script.submission = { ...script.submission, state: 'eingereicht', files: [], can_edit: false };
    render(
      <QueryProvider>
        <AbgabeView />
      </QueryProvider>,
    );
    expect(await screen.findByText(/Eingereicht\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Endgültig einreichen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dateien wählen' })).toBeDisabled();
    expect(screen.getByText('Die Aufgabe ist schon eingereicht.')).toBeInTheDocument();
  });

  it('fragt der Core beim Speichern nach, heißt das Bestätigen „Speichern und abgeben“, auch wenn die Aufgabe hier anders aussieht', async () => {
    // Die Aufgabenliste meldet noch einen Einreichen-Schritt, der Core sieht keinen (veraltet oder unbekannt)
    script.preview.push(() =>
      json(
        previewBody({
          action_id: 'assign.save_draft',
          risk: 'aenderbar',
          summary: '1 Datei als Entwurf in ‚Blatt 3‘ speichern: blatt3.pdf (1 KB).',
          warnings: ['Bei dieser Aufgabe ist Speichern schon die Abgabe.'],
          details: { files: [{ name: 'blatt3.pdf', size_bytes: 1 }] },
        }),
      ),
    );
    const user = userEvent.setup();
    const { container } = render(
      <QueryProvider>
        <AbgabeView />
      </QueryProvider>,
    );
    const save = await screen.findByRole('button', { name: 'Als Entwurf speichern' });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['x'], 'blatt3.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Speichern und abgeben' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toHaveFocus();
    expect(callsTo('/execute')).toHaveLength(0);
  });

  it('bei Aufgaben ohne Einreichen-Schritt steht das ehrlich da', async () => {
    script.assignment = { ...script.assignment, requires_submit: false };
    render(
      <QueryProvider>
        <AbgabeView />
      </QueryProvider>,
    );
    expect(await screen.findByText(/Speichern schon die Abgabe/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Endgültig einreichen' })).not.toBeInTheDocument();
  });

  it('ohne Aufgabe in der Adresse ein ruhiger Hinweis', async () => {
    search.value = '';
    render(
      <QueryProvider>
        <AbgabeView />
      </QueryProvider>,
    );
    expect(await screen.findByText(/braucht eine Aufgabe/)).toBeInTheDocument();
  });

  it('Aktion im Katalog nicht verfügbar: Knopf aus, mit Grund', async () => {
    script.catalog = [
      { id: 'assign.save_draft', label: 'Als Entwurf speichern', available: false },
      { id: 'assign.submit', label: 'Abgabe einreichen', available: false },
    ];
    render(
      <QueryProvider>
        <AbgabeView />
      </QueryProvider>,
    );
    await waitFor(() => expect(screen.getAllByText('Dein Moodle-Zugang erlaubt das nicht.')).toHaveLength(2));
  });
});

describe('Seite „Abgabe“: Stand oben (UX-312) und Zugang (UX-313)', () => {
  it('der Stand steht vor den Dateien, mit Frist; „In Moodle öffnen“ ist Hauptknopf, wenn die Aktionen aus sind', async () => {
    script.catalog = [
      { id: 'assign.save_draft', label: 'Als Entwurf speichern', available: false },
      { id: 'assign.submit', label: 'Abgabe einreichen', available: false },
    ];
    render(
      <QueryProvider>
        <AbgabeView />
      </QueryProvider>,
    );
    expect(await screen.findByText(/Abgeben aus der App ist noch nicht freigeschaltet/)).toBeInTheDocument();
    const stand = screen.getByRole('heading', { name: 'Stand in Moodle' });
    const dateien = screen.getByRole('heading', { name: 'Dateien für den Entwurf' });
    expect(stand.compareDocumentPosition(dateien) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const section = stand.closest('section') as HTMLElement;
    expect(within(section).getByText(/Frist:/)).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'In Moodle öffnen' })).toBeInTheDocument();
  });

  it('Aktionen an: keine Zeile „noch nicht freigeschaltet“', async () => {
    render(
      <QueryProvider>
        <AbgabeView />
      </QueryProvider>,
    );
    await screen.findByText(/Entwurf gespeichert/);
    expect(screen.queryByText(/noch nicht freigeschaltet/)).not.toBeInTheDocument();
  });

  it('Zugang abgelehnt: „In Moodle öffnen“ steht vor dem Weg zum Erneuern', async () => {
    script.status = { ...script.status, state: 'ungueltig' };
    script.submissionError = apiError(401, 'moodle_token_invalid');
    render(
      <QueryProvider>
        <AbgabeView />
      </QueryProvider>,
    );
    const hint = await screen.findByText(/Moodle nimmt den Zugang nicht mehr an/);
    const link = screen.getByRole('link', { name: 'In Moodle öffnen' });
    expect(link.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText(/pnpm sg moodle login/)).toHaveLength(1);
    // Der Katalog ist dann auch ganz aus, aber der Grund ist der Zugang, nicht der Schalter
    expect(screen.queryByText(/noch nicht freigeschaltet/)).not.toBeInTheDocument();
  });

  it('Moodle nicht erreichbar: keine Zeile „noch nicht freigeschaltet“, obwohl der Katalog alles aus meldet', async () => {
    script.status = { ...script.status, state: 'nicht_erreichbar' };
    script.catalog = [
      { id: 'assign.save_draft', label: 'Als Entwurf speichern', available: false },
      { id: 'assign.submit', label: 'Abgabe einreichen', available: false },
    ];
    render(
      <QueryProvider>
        <AbgabeView />
      </QueryProvider>,
    );
    await screen.findByText(/Entwurf gespeichert/);
    await screen.findAllByText('Dein Moodle-Zugang erlaubt das nicht.');
    expect(screen.queryByText(/noch nicht freigeschaltet/)).not.toBeInTheDocument();
  });
});

describe('Fristenliste', () => {
  it('verlinkt Aufgaben zur Seite „Abgabe“', async () => {
    script.deadlines = [
      {
        id: '0190f6a2-0000-7000-8000-000000000501',
        source: 'aufgabe',
        moodle_course_id: 901,
        module_id: '0190f6a2-0000-7000-8000-0000000000a1',
        assignment_id: 42,
        event_id: null,
        cmid: 7,
        name: 'Blatt 3',
        due_at: '2026-11-12T22:59:00Z',
        url: null,
        exercise_sheet_id: null,
        removed_in_moodle_at: null,
      },
    ];
    render(
      <QueryProvider>
        <MoodleDeadlines headingId="h" />
      </QueryProvider>,
    );
    const link = await screen.findByRole('link', { name: 'Abgeben' });
    expect(link).toHaveAttribute('href', '/abgabe?aufgabe=42&modul=0190f6a2-0000-7000-8000-0000000000a1');
  });
});
