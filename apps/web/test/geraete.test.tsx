// Einstellungen → Geräte (T1-10): Liste, Entfernen mit Bestätigung, Kopplung per QR/Code, Anfragen, Zustände
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import qrcode from 'qrcode-generator';

vi.mock('next/navigation', () => ({
  usePathname: () => '/einstellungen',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn() }),
}));

import { AppShell } from '../src/components/AppShell.tsx';
import { SettingsView } from '../src/components/SettingsView.tsx';
import { PairingQr } from '../src/components/settings/PairingQr.tsx';
import { formatRemaining, groupCode, remainingAnnouncement } from '../src/lib/devices.ts';
import { QueryProvider } from '../src/lib/query.tsx';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { installFakeCore, makeDevice, type FakeCore } from './fake-core.ts';

function page() {
  return render(
    <ThemeProvider>
      <QueryProvider>
        <AppShell>
          <SettingsView />
        </AppShell>
      </QueryProvider>
    </ThemeProvider>,
  );
}

async function openDevicesTab() {
  const user = userEvent.setup();
  page();
  await user.click(screen.getByRole('tab', { name: 'Geräte' }));
  const panel = screen.getByRole('tabpanel', { name: 'Geräte' });
  return { user, panel };
}

const calls = (core: FakeCore, method: string, path: string | RegExp) =>
  core.requests.filter(
    (r) => r.method === method && (typeof path === 'string' ? r.path === path : path.test(r.path)),
  );

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Gekoppelte Geräte', () => {
  it('zeigt Name, Art und „zuletzt gesehen“; ohne Geräte einen Hinweis', async () => {
    const core = installFakeCore();
    core.devices.push(
      makeDevice({ last_seen_at: new Date(Date.now() - 3 * 60_000).toISOString(), connected: true }),
      makeDevice({
        id: '0190f6a2-0000-7000-8000-0000000000c2',
        name: 'Altes iPhone',
        kind: 'iphone',
        last_seen_at: null,
      }),
    );
    const { panel } = await openDevicesTab();
    const list = await within(panel).findByRole('list', { name: 'Gekoppelte Geräte' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('iPad von Ilian');
    expect(items[0]).toHaveTextContent('verbunden');
    expect(items[0]).toHaveTextContent('Zuletzt gesehen: vor 3 Minuten');
    expect(items[1]).toHaveTextContent('iPhone');
    expect(items[1]).toHaveTextContent('Zuletzt gesehen: noch nie');
  });

  it('ohne Geräte: „Noch kein Gerät gekoppelt“', async () => {
    installFakeCore();
    const { panel } = await openDevicesTab();
    expect(await within(panel).findByText('Noch kein Gerät gekoppelt.')).toBeInTheDocument();
  });

  it('Entfernen braucht eine Bestätigung; Abbrechen und Escape lassen das Gerät, Fokus kehrt zurück', async () => {
    const core = installFakeCore();
    core.devices.push(makeDevice());
    const { user, panel } = await openDevicesTab();
    const remove = await within(panel).findByRole('button', { name: 'Entfernen: iPad von Ilian' });
    await user.click(remove);
    const yes = within(panel).getByRole('button', { name: 'Ja, entfernen: iPad von Ilian' });
    expect(yes).toHaveFocus();
    expect(within(panel).getByText(/verliert sofort den Zugang/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() =>
      expect(within(panel).getByRole('button', { name: 'Entfernen: iPad von Ilian' })).toHaveFocus(),
    );

    await user.click(within(panel).getByRole('button', { name: 'Entfernen: iPad von Ilian' }));
    await user.keyboard('{Escape}');
    expect(within(panel).queryByRole('button', { name: /Ja, entfernen/ })).not.toBeInTheDocument();
    expect(calls(core, 'DELETE', /^\/devices\//)).toHaveLength(0);
  });

  it('Bestätigtes Entfernen sendet DELETE, nimmt das Gerät aus der Liste und meldet es', async () => {
    const core = installFakeCore();
    core.devices.push(makeDevice());
    const { user, panel } = await openDevicesTab();
    await user.click(await within(panel).findByRole('button', { name: 'Entfernen: iPad von Ilian' }));
    await user.click(within(panel).getByRole('button', { name: 'Ja, entfernen: iPad von Ilian' }));
    await waitFor(() => expect(within(panel).getByText('Noch kein Gerät gekoppelt.')).toBeInTheDocument());
    expect(calls(core, 'DELETE', `/devices/${makeDevice().id}`)).toHaveLength(1);
    expect(await screen.findByText('iPad von Ilian entfernt')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(panel).getByRole('heading', { name: 'Gekoppelte Geräte' })).toHaveFocus(),
    );
  });
});

describe('iPad koppeln', () => {
  it('öffnet das Fenster: QR-Code, Code, Adresse, Port und Countdown; Fokus auf der Überschrift', async () => {
    const core = installFakeCore();
    const { user, panel } = await openDevicesTab();
    await user.click(within(panel).getByRole('button', { name: 'iPad koppeln' }));
    const heading = await within(panel).findByRole('heading', { name: 'iPad koppeln' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(calls(core, 'POST', '/devices/pairings')).toHaveLength(1);

    const window = core.pairing.window;
    expect(window).not.toBeNull();
    expect(within(panel).getByRole('img', { name: 'QR-Code zum Koppeln des iPads' })).toBeInTheDocument();
    const code = within(panel).getByLabelText(`Code ${window?.code.split('').join(' ')}`);
    expect(code).toHaveTextContent(groupCode(window?.code ?? ''));
    expect(within(panel).getByText('192.168.1.20')).toBeInTheDocument();
    expect(within(panel).getByText('4710')).toBeInTheDocument();
    expect(within(panel).getByText(/^[45]:\d\d$/)).toBeInTheDocument();
  });

  it('zeigt Anfragen aus dem Netzwerk mit Warnhinweis; „Ablehnen“ sendet DELETE', async () => {
    const core = installFakeCore();
    const { user, panel } = await openDevicesTab();
    await user.click(within(panel).getByRole('button', { name: 'iPad koppeln' }));
    await within(panel).findByRole('heading', { name: 'iPad koppeln' });
    const request = core.addPairingRequest('iPad von Ilian (?)');

    const list = await within(panel).findByRole(
      'list',
      { name: 'Offene Kopplungsanfragen' },
      { timeout: 4_000 },
    );
    expect(list).toHaveTextContent('iPad von Ilian (?)');
    expect(within(panel).getByText(/Name und Absender sind nicht geprüft/)).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'Ablehnen: iPad von Ilian (?)' }));
    await waitFor(() =>
      expect(within(panel).queryByRole('list', { name: 'Offene Kopplungsanfragen' })).not.toBeInTheDocument(),
    );
    expect(calls(core, 'DELETE', `/devices/pairings/requests/${request.request_id}`)).toHaveLength(1);
  });

  it('nach erfolgreicher Kopplung: Meldung mit Name und Art und „Entfernen“, Gerät als neu markiert', async () => {
    const core = installFakeCore();
    core.devices.push(makeDevice());
    const { user, panel } = await openDevicesTab();
    await within(panel).findByText('iPad von Ilian');
    await user.click(within(panel).getByRole('button', { name: 'iPad koppeln' }));
    await within(panel).findByRole('heading', { name: 'iPad koppeln' });
    const windowId = core.pairing.window?.pairing_id ?? '';
    const created = core.completePairing('Neues iPad');
    expect(
      await screen.findByText('„Neues iPad“ (iPad) wurde gekoppelt. Nicht du?', {}, { timeout: 4_000 }),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole('heading', { name: 'iPad koppeln' })).not.toBeInTheDocument();
    const list = await within(panel).findByRole('list', { name: 'Gekoppelte Geräte' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));
    const [old, fresh] = within(list).getAllByRole('listitem');
    expect(fresh).toHaveTextContent('Neues iPad');
    expect(fresh).toHaveTextContent('Neu gekoppelt');
    expect(old).not.toHaveTextContent('Neu gekoppelt');
    // Ein gekoppeltes Fenster wird nicht noch einmal geschlossen
    await new Promise((r) => setTimeout(r, 50));
    expect(calls(core, 'DELETE', `/devices/pairings?pairing_id=${windowId}`)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Entfernen' }));
    await waitFor(() => expect(calls(core, 'DELETE', `/devices/${created.id}`)).toHaveLength(1));
    expect(await screen.findByText('Neues iPad entfernt')).toBeInTheDocument();
  });

  it('„Schließen“ schließt das Fenster auch am Core (DELETE /devices/pairings?pairing_id=…)', async () => {
    const core = installFakeCore();
    const { user, panel } = await openDevicesTab();
    await user.click(within(panel).getByRole('button', { name: 'iPad koppeln' }));
    await within(panel).findByRole('heading', { name: 'iPad koppeln' });
    const id = core.pairing.window?.pairing_id ?? '';
    await user.click(within(panel).getByRole('button', { name: 'Schließen' }));
    await waitFor(() => expect(calls(core, 'DELETE', `/devices/pairings?pairing_id=${id}`)).toHaveLength(1));
    expect(core.pairing.state).toBe('closed');
  });

  it('Strict Mode (Effekte doppelt) schließt das gerade geöffnete Fenster nicht', async () => {
    const core = installFakeCore();
    const user = userEvent.setup();
    render(
      <StrictMode>
        <ThemeProvider>
          <QueryProvider>
            <AppShell>
              <SettingsView />
            </AppShell>
          </QueryProvider>
        </ThemeProvider>
      </StrictMode>,
    );
    await user.click(screen.getByRole('tab', { name: 'Geräte' }));
    const panel = screen.getByRole('tabpanel', { name: 'Geräte' });
    await user.click(within(panel).getByRole('button', { name: 'iPad koppeln' }));
    await within(panel).findByRole('heading', { name: 'iPad koppeln' });
    const id = core.pairing.window?.pairing_id ?? '';
    await new Promise((r) => setTimeout(r, 100));
    expect(calls(core, 'DELETE', `/devices/pairings?pairing_id=${id}`)).toHaveLength(0);
    expect(core.pairing.state).toBe('open');
  });

  it('Verlassen der Ansicht und Schließen des Tabs schließen das Fenster am Core', async () => {
    const core = installFakeCore();
    const { user, panel } = await openDevicesTab();
    await user.click(within(panel).getByRole('button', { name: 'iPad koppeln' }));
    await within(panel).findByRole('heading', { name: 'iPad koppeln' });
    const first = core.pairing.window?.pairing_id ?? '';
    window.dispatchEvent(new Event('pagehide'));
    await waitFor(() =>
      expect(calls(core, 'DELETE', `/devices/pairings?pairing_id=${first}`)).toHaveLength(1),
    );

    // Neues Fenster, dann die ganze Seite abbauen (Navigation)
    core.pairing.state = 'open';
    await user.click(within(panel).getByRole('button', { name: 'Neuen Code erzeugen' }));
    await waitFor(() => expect(calls(core, 'POST', '/devices/pairings')).toHaveLength(2));
    const second = core.pairing.window?.pairing_id ?? '';
    cleanup();
    await waitFor(() =>
      expect(calls(core, 'DELETE', `/devices/pairings?pairing_id=${second}`)).toHaveLength(1),
    );
  });

  it('viele Fehlversuche über das Netzwerk: Hinweis, QR-Code bleibt sichtbar', async () => {
    const core = installFakeCore();
    const { user, panel } = await openDevicesTab();
    await user.click(within(panel).getByRole('button', { name: 'iPad koppeln' }));
    await within(panel).findByRole('heading', { name: 'iPad koppeln' });
    core.pairing.state = 'qr_only';
    expect(
      await within(panel).findByText('Viele falsche Codes über das Netzwerk.', {}, { timeout: 4_000 }),
    ).toBeInTheDocument();
    expect(within(panel).getByText(/anderen Netz/)).toBeInTheDocument();
    expect(within(panel).getByRole('img', { name: 'QR-Code zum Koppeln des iPads' })).toBeInTheDocument();
  });

  it('gesperrt nach vielen Fehlversuchen: rät zum Netzwechsel, „Neuen Code erzeugen“ öffnet ein neues Fenster', async () => {
    const core = installFakeCore();
    const { user, panel } = await openDevicesTab();
    await user.click(within(panel).getByRole('button', { name: 'iPad koppeln' }));
    await within(panel).findByRole('heading', { name: 'iPad koppeln' });
    core.pairing.state = 'locked';
    expect(await within(panel).findByText(/Viele Fehlversuche/, {}, { timeout: 4_000 })).toBeInTheDocument();
    expect(within(panel).getByText(/Heim-WLAN/)).toBeInTheDocument();
    expect(within(panel).queryByRole('img', { name: /QR-Code/ })).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Neuen Code erzeugen' }));
    await waitFor(() => expect(calls(core, 'POST', '/devices/pairings')).toHaveLength(2));
    expect(
      await within(panel).findByRole('img', { name: 'QR-Code zum Koppeln des iPads' }),
    ).toBeInTheDocument();
  });

  it('abgelaufen bzw. anderswo ersetzt: klarer Hinweis statt QR-Code', async () => {
    const core = installFakeCore();
    const { user, panel } = await openDevicesTab();
    await user.click(within(panel).getByRole('button', { name: 'iPad koppeln' }));
    await within(panel).findByRole('heading', { name: 'iPad koppeln' });
    core.pairing.state = 'expired';
    expect(
      await within(panel).findByText(/Der Code ist abgelaufen/, {}, { timeout: 4_000 }),
    ).toBeInTheDocument();

    core.pairing.state = 'open';
    if (core.pairing.window)
      core.pairing.window = { ...core.pairing.window, pairing_id: '0190f6a2-0000-4000-8000-0000000000aa' };
    expect(await within(panel).findByText(/gilt nicht mehr/, {}, { timeout: 4_000 })).toBeInTheDocument();
  });

  it('„Schließen“ gibt den Fokus an „iPad koppeln“ zurück', async () => {
    installFakeCore();
    const { user, panel } = await openDevicesTab();
    await user.click(within(panel).getByRole('button', { name: 'iPad koppeln' }));
    await within(panel).findByRole('heading', { name: 'iPad koppeln' });
    await user.click(within(panel).getByRole('button', { name: 'Schließen' }));
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'iPad koppeln' })).toHaveFocus());
  });

  it('fragt nicht ab, solange der Reiter verborgen ist', async () => {
    const core = installFakeCore();
    const { user, panel } = await openDevicesTab();
    await user.click(within(panel).getByRole('button', { name: 'iPad koppeln' }));
    await within(panel).findByRole('heading', { name: 'iPad koppeln' });
    await waitFor(() => expect(calls(core, 'GET', '/devices/pairings/requests').length).toBeGreaterThan(0));
    await user.click(screen.getByRole('tab', { name: 'Allgemein' }));
    const before = calls(core, 'GET', '/devices/pairings/requests').length;
    await new Promise((r) => setTimeout(r, 2_500));
    expect(calls(core, 'GET', '/devices/pairings/requests')).toHaveLength(before);
  });
});

describe('Hilfsfunktionen', () => {
  it('Countdown und sparsame Ansagen', () => {
    expect(formatRemaining(300_000)).toBe('5:00');
    expect(formatRemaining(61_500)).toBe('1:02');
    expect(formatRemaining(-5)).toBe('0:00');
    expect(remainingAnnouncement(240_000)).toBe('Der Code gilt noch 4 Minuten.');
    expect(remainingAnnouncement(60_000)).toBe('Der Code gilt noch 1 Minute.');
    expect(remainingAnnouncement(30_000)).toBe('Der Code gilt noch 30 Sekunden.');
    expect(remainingAnnouncement(0)).toBe('Der Code ist abgelaufen.');
    expect(remainingAnnouncement(59_000)).toBeNull();
    expect(groupCode('482913')).toBe('482 913');
  });

  it('der QR-Code trägt genau die Daten aus qr_url (gleiche Matrix wie qrcode-generator)', () => {
    const value =
      'sg://pair?v=1&host=192.168.1.20&port=4710&pairing_id=0190f6a2-0000-4000-8000-000000000001&code=482914';
    const { container } = render(<PairingQr value={value} label="QR" />);
    const qr = qrcode(0, 'M');
    qr.addData(value, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe(`0 0 ${n + 8} ${n + 8}`);
    const d = container.querySelector('path')?.getAttribute('d') ?? '';
    let dark = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) dark++;
    expect(d.match(/M/g)).toHaveLength(dark);
    expect(d.startsWith('M4 4h1v1h-1z')).toBe(true);
  });
});
