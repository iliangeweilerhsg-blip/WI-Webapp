// Hydration (React #418): Waren Abfragen schon fertig, bevor ein Teil der Seite hydratisiert wurde, darf das
// nicht vom vorgerenderten HTML („lädt“) abweichen.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { act } from 'react';
import { waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  usePathname: () => '/einstellungen',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn() }),
}));

import { AppShell } from '../src/components/AppShell.tsx';
import { SettingsView } from '../src/components/SettingsView.tsx';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { installFakeCore, makeModule, makeSemester } from './fake-core.ts';

const tree = (client: QueryClient) => (
  <ThemeProvider>
    <QueryClientProvider client={client}>
      <AppShell>
        <SettingsView />
      </AppShell>
    </QueryClientProvider>
  </ThemeProvider>
);

describe('Hydration', () => {
  it('Daten, die vor der Hydration schon da sind, führen nicht zu einem Mismatch', async () => {
    installFakeCore({ semesters: [makeSemester()], modules: [makeModule()] });
    const container = document.createElement('div');
    container.innerHTML = renderToString(tree(new QueryClient()));
    document.body.appendChild(container);

    const client = new QueryClient();
    client.setQueryData(['health'], { status: 'ok', db: 'ok', version: '1' });
    client.setQueryData(['semesters'], { items: [makeSemester()], next_cursor: null });
    client.setQueryData(['modules'], { items: [makeModule()], next_cursor: null });

    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.map(String).join(' ').slice(0, 400));
    });
    await act(async () => {
      hydrateRoot(container, tree(client), {
        onRecoverableError: (e) => errors.push(String(e).slice(0, 400)),
      });
    });
    spy.mockRestore();
    expect(errors).toEqual([]);
    // Nach der Hydration zeigt die Seite die Daten
    await waitFor(() => expect(container.textContent).toContain('Core verbunden'));
  });

  // Ursache von React #418 unter Last (Folgepunkt 2): Kam das Theme-Skript des `<head>` aus einer Client-Datei, war es
  // für das Layout eine Modulreferenz. Der `<head>` hing dann an einem noch ladenden Chunk, React unterbrach die
  // Hydration mitten im `<head>` und setzte danach den Cursor falsch (React-Fehler bei `head` als Singleton).
  it('das Theme-Skript im <head> ist eine einfache Zeichenkette, keine Referenz auf ein Client-Modul', () => {
    const src = (file: string) => readFileSync(join(process.cwd(), 'src', file), 'utf8');
    expect(src('lib/theme-init.ts')).not.toMatch(/^\s*['"]use client['"]/m);
    expect(src('app/layout.tsx')).toMatch(/THEME_INIT_SCRIPT[^;]*from '..\/lib\/theme-init\.ts'/);
    // Auch sonst steht im <head> nichts, was aus einer Client-Datei kommt
    const head = /<head>([\s\S]*?)<\/head>/.exec(src('app/layout.tsx'))?.[1] ?? '';
    expect(head).toContain('THEME_INIT_SCRIPT');
    expect(head).not.toMatch(/<[A-Z]/);
  });
});
