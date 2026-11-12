// UX-11: Speicherplatz in Einstellungen → Daten, ruhige Warnung auf „Heute“
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { Session } from '@sg/shared';

const rec = vi.hoisted(() => ({ phase: 'andere' as 'andere' | 'laeuft' | 'pausiert' }));
vi.mock('../src/lib/recording/index.ts', async (original) => ({
  ...(await original<typeof import('../src/lib/recording/index.ts')>()),
  useRecordingView: () => ({ phase: rec.phase }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn() }),
}));

import { StorageInfo } from '../src/components/settings/StorageInfo.tsx';
import { StorageHint } from '../src/components/today/StorageHint.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import { AUDIO_BITS_PER_SECOND } from '../src/lib/recorder/recorder.ts';
import {
  AUDIO_BYTES_PER_HOUR,
  STORAGE_BYTES_PER_LECTURE,
  STORAGE_WARN_BELOW_BYTES,
  isStorageLow,
  lecturesThatFit,
} from '../src/lib/storage.ts';
import { makeSession } from './fake-core.ts';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function storageBody(overrides: Record<string, unknown> = {}) {
  return {
    data_dir_free_bytes: 40 * GB,
    data_dir_size_bytes: 3 * GB,
    media_bytes: 2.5 * GB,
    vault_bytes: 100 * MB,
    db_bytes: 200 * MB,
    measured_at: '2026-11-12T08:00:00Z',
    ...overrides,
  };
}

function stubStorage(body: Record<string, unknown> | 'fehler') {
  const fetchSpy = vi.fn(async (input: string) => {
    if (!String(input).includes('/system/storage') || body === 'fehler')
      return Response.json({ error: { code: 'not_found', message: 'x' } }, { status: 404 });
    return Response.json(body);
  });
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

beforeEach(() => {
  rec.phase = 'andere';
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Platzbedarf aus der Bitrate', () => {
  it('48 kbit/s ergeben 21,6 MB je Stunde Audio', () => {
    expect(AUDIO_BITS_PER_SECOND).toBe(48_000);
    expect(AUDIO_BYTES_PER_HOUR).toBe(21_600_000);
  });

  it('Schwelle: 2 Vorlesungen à 1,5 Stunden mit dreifachem Bedarf (rund 194 MB)', () => {
    expect(STORAGE_BYTES_PER_LECTURE).toBeCloseTo(97_200_000);
    expect(STORAGE_WARN_BELOW_BYTES).toBeCloseTo(194_400_000);
  });

  it('isStorageLow und lecturesThatFit liegen an der Grenze richtig', () => {
    expect(isStorageLow(STORAGE_WARN_BELOW_BYTES - 1)).toBe(true);
    expect(isStorageLow(STORAGE_WARN_BELOW_BYTES)).toBe(false);
    expect(lecturesThatFit(0)).toBe(0);
    expect(lecturesThatFit(STORAGE_BYTES_PER_LECTURE * 1.5)).toBe(1);
    expect(lecturesThatFit(STORAGE_BYTES_PER_LECTURE * 3)).toBe(3);
  });
});

function renderInfo() {
  return render(
    <QueryProvider>
      <StorageInfo />
    </QueryProvider>,
  );
}

describe('Einstellungen → Daten: Speicherplatz', () => {
  it('zeigt belegt (Daten plus Datenbank), frei und die Aufteilung', async () => {
    stubStorage(storageBody());
    renderInfo();
    expect(await screen.findByText(/Belegt: 3\.2 GB\. Frei auf dem Mac: 40\.0 GB\./)).toBeInTheDocument();
    expect(screen.getByText(/Aufnahmen, Folien und Notizen: 2\.5 GB/)).toBeInTheDocument();
    expect(screen.getByText(/Vault: 100\.0 MB/)).toBeInTheDocument();
    expect(screen.getByText(/Datenbank: 200\.0 MB/)).toBeInTheDocument();
    expect(screen.getByText(/Das reicht für etwa \d+ Vorlesungen Audio\./)).toBeInTheDocument();
  });

  it('ohne optionale Aufteilung nur belegt und frei', async () => {
    stubStorage({
      data_dir_free_bytes: 10 * GB,
      data_dir_size_bytes: 1 * GB,
      measured_at: '2026-11-12T08:00:00Z',
    });
    renderInfo();
    expect(await screen.findByText(/Belegt: 1\.0 GB\. Frei auf dem Mac: 10\.0 GB\./)).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('wenig Platz: sagt es ruhig dazu', async () => {
    stubStorage(storageBody({ data_dir_free_bytes: 50 * MB }));
    renderInfo();
    expect(await screen.findByText(/Das reicht nicht für eine ganze Vorlesung Audio\./)).toBeInTheDocument();
    expect(screen.getByText(/Räume Platz frei/)).toBeInTheDocument();
  });

  it('Fehler der Abfrage (älterer Core): nichts', async () => {
    const fetchSpy = stubStorage('fehler');
    const { container } = renderInfo();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await act(async () => undefined);
    expect(container).toBeEmptyDOMElement();
  });
});

function hint(sessions: Session[] = []) {
  return render(
    <QueryProvider>
      <StorageHint sessions={sessions} />
    </QueryProvider>,
  );
}

describe('Speicher-Hinweis auf „Heute“', () => {
  it('unter 2 Vorlesungen: ruhige Zeile mit Link zu Einstellungen → Daten', async () => {
    stubStorage(storageBody({ data_dir_free_bytes: 150 * MB }));
    hint();
    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent(/nur noch 150\.0 MB frei/);
    expect(note).toHaveTextContent(/Das reicht für etwa eine Vorlesung\./);
    expect(screen.getByRole('link', { name: 'Speicherplatz' })).toHaveAttribute(
      'href',
      '/einstellungen?bereich=daten',
    );
  });

  it('kaum Platz: reicht nicht für eine Vorlesung', async () => {
    stubStorage(storageBody({ data_dir_free_bytes: 20 * MB }));
    hint();
    expect(await screen.findByText(/reicht nicht für eine ganze Vorlesung/)).toBeInTheDocument();
  });

  it('genug Platz: kein Hinweis', async () => {
    const fetchSpy = stubStorage(storageBody());
    hint();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('Fehler der Abfrage: kein Hinweis', async () => {
    const fetchSpy = stubStorage('fehler');
    hint();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('nie während einer laufenden oder pausierten Aufnahme', async () => {
    const fetchSpy = stubStorage(storageBody({ data_dir_free_bytes: 10 * MB }));
    rec.phase = 'laeuft';
    const first = hint();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByRole('status')).toBeNull();
    first.unmount();
    rec.phase = 'pausiert';
    hint();
    await act(async () => undefined);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('nie, solange eine Session läuft oder pausiert (auch am iPad gestartet)', async () => {
    const fetchSpy = stubStorage(storageBody({ data_dir_free_bytes: 10 * MB }));
    const first = hint([makeSession({ state: 'laeuft' })]);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByRole('status')).toBeNull();
    first.unmount();
    hint([makeSession({ state: 'pausiert' })]);
    await act(async () => undefined);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('beendete Session zählt nicht: Hinweis erscheint', async () => {
    stubStorage(storageBody({ data_dir_free_bytes: 10 * MB }));
    hint([makeSession({ state: 'beendet' })]);
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });
});
