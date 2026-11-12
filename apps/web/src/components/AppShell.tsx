'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { isMacPlatform, matchShortcut } from '../lib/shortcuts.ts';
import { SIDEBAR_KEY } from '../lib/theme.tsx';
import { SIDEBAR_AUTO_ATTR } from '../lib/theme-init.ts';
import { RecordingProvider, useNoteRecordingIntent, type RecordingEnv } from '../lib/recording';
import { useResumePendingUploads } from '../lib/recorder/useResumePendingUploads.ts';
import { ErrorShelf } from '../lib/sync/ErrorShelf.tsx';
import { OtherTabBanner } from '../lib/sync/OtherTabBanner.tsx';
import { SyncProvider, useSyncClient } from '../lib/sync/SyncProvider.tsx';
import type { SyncClient } from '../lib/sync/client.ts';
import { ToastProvider } from '../lib/toast.tsx';
import { UploadProvider } from '../lib/uploads.tsx';
import { Icon } from './Icon.tsx';
import { RecordingBar } from './recording/RecordingBar.tsx';
import { SearchOverlay } from './search/SearchOverlay.tsx';
import { SetupHost } from './SetupHost.tsx';
import { Sidebar } from './Sidebar.tsx';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
const NARROW_QUERY = '(max-width: 767.98px)';

/** App-Rahmen (07 §2): Seitenleiste (breit einklappbar, schmal als Drawer), Inhalt, Sync-Hinweise, globale Kürzel. */
export function AppShell({
  children,
  syncClient,
  recordingEnv,
}: {
  children: ReactNode;
  syncClient?: SyncClient;
  /** Nur für Tests: gefälschte Browser-Schnittstellen der Aufnahme */
  recordingEnv?: RecordingEnv;
}) {
  return (
    <SyncProvider {...(syncClient ? { client: syncClient } : {})}>
      <RecordingProvider {...(recordingEnv ? { env: recordingEnv } : {})}>
        <Shell>{children}</Shell>
      </RecordingProvider>
    </SyncProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const sync = useSyncClient();
  // Ungesendete Aufnahme-Chunks nachholen, ab dem App-Start und nur im Leader-Tab (Issue #115)
  useResumePendingUploads(sync);
  // „Hier übernehmen“ ist eine Nutzeraktion: Sie erlaubt dem Tab, das Mikrofon zu öffnen, sobald er Leader ist
  const noteRecordingIntent = useNoteRecordingIntent();

  // bfcache (Plan 210, E8): Kommt die Seite aus dem Cache zurück, sind Mikrofon, Sperren und WebSocket in unbekanntem
  // Zustand. Neuladen ist der Weg, den der Vertrag („Nach dem Neuladen“, §11.8) schon beschreibt.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [setupRequested, setSetupRequested] = useState(0);
  // Die PDF-Anzeige (F-ORG-04) und das Live-Dashboard (T1-04) nutzen die ganze Fläche und scrollen selbst
  const pathname = usePathname();
  const fullBleed = pathname === '/dokument' || pathname === '/session' || pathname === '/rueckblick';

  const modal = drawerOpen && isNarrow;

  // Live-Dashboard: Die Seitenleiste klappt ein, damit die Folie genug Platz hat. Nichts davon wird gespeichert
  // (kein localStorage). Beim Verlassen kommt der alte Zustand zurück, außer der Nutzer hat selbst umgeschaltet.
  // Beim direkten Laden hat das Init-Skript schon eingeklappt (`data-sidebar-auto`), damit nichts springt.
  const autoCollapsed = useRef(false);
  const userToggled = useRef(false);
  const onSession = /^\/session\/?$/.test(pathname);
  useEffect(() => {
    const root = document.documentElement;
    if (root.hasAttribute(SIDEBAR_AUTO_ATTR)) {
      autoCollapsed.current = true;
      root.removeAttribute(SIDEBAR_AUTO_ATTR);
    }
    if (onSession && !isNarrow) {
      if (!autoCollapsed.current && root.getAttribute('data-sidebar') !== 'collapsed') {
        root.setAttribute('data-sidebar', 'collapsed');
        autoCollapsed.current = true;
        userToggled.current = false;
      }
      if (autoCollapsed.current && !userToggled.current) setExpanded(false);
    } else if (autoCollapsed.current) {
      autoCollapsed.current = false;
      if (!userToggled.current) {
        root.removeAttribute('data-sidebar');
        setExpanded(true);
      }
      userToggled.current = false;
    }
  }, [onSession, isNarrow]);

  // Fokus erst nach dem Schließen setzen: Solange der Drawer offen ist, ist der Rest `inert`
  const returnFocus = useRef<'menu' | 'main' | null>(null);
  const closeDrawer = useCallback((target: 'menu' | 'main' | null = 'menu') => {
    returnFocus.current = target;
    setDrawerOpen(false);
  }, []);
  useEffect(() => {
    if (drawerOpen || !returnFocus.current) return;
    const target = returnFocus.current === 'menu' ? menuButton.current : document.getElementById('main');
    returnFocus.current = null;
    target?.focus();
  }, [drawerOpen]);

  // Navigation schließt den Drawer, der Fokus geht in den Inhalt
  const firstPath = useRef(pathname);
  const drawerOpenRef = useRef(drawerOpen);
  drawerOpenRef.current = drawerOpen;
  useEffect(() => {
    if (firstPath.current === pathname) return;
    firstPath.current = pathname;
    if (drawerOpenRef.current) closeDrawer('main');
  }, [pathname, closeDrawer]);

  // Wechsel auf einen breiten Bildschirm schließt ihn
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = (e: { matches: boolean }) => {
      setIsNarrow(e.matches);
      if (!e.matches) setDrawerOpen(false);
    };
    onChange(mq);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  // Offener Drawer: Fokus hinein, Fokusfalle, Esc
  useEffect(() => {
    if (!drawerOpen) return;
    const aside = document.getElementById('sidebar');
    const items = () => Array.from(aside?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    items()[0]?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Behandelt ein Element im Drawer Esc selbst, bleibt der Drawer offen
        if (e.defaultPrevented) return;
        e.preventDefault();
        closeDrawer();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = items();
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      const active = document.activeElement;
      if (!aside?.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, closeDrawer]);

  useEffect(() => {
    const root = document.documentElement;
    setExpanded(root.getAttribute('data-sidebar') !== 'collapsed');
    // Übergang erst nach dem ersten Rendern erlauben, damit die Leiste beim Laden nicht „fährt"
    const id = requestAnimationFrame(() => root.setAttribute('data-ready', ''));
    return () => cancelAnimationFrame(id);
  }, []);

  const toggleSidebar = useCallback(() => {
    if (isNarrow) {
      // Schmal ist die Leiste ein Drawer; das Ein-/Ausklappen (data-sidebar) betrifft nur breite Bildschirme
      setDrawerOpen((o) => !o);
      return;
    }
    const root = document.documentElement;
    if (autoCollapsed.current) userToggled.current = true;
    const collapse = root.getAttribute('data-sidebar') !== 'collapsed';
    if (collapse) root.setAttribute('data-sidebar', 'collapsed');
    else root.removeAttribute('data-sidebar');
    setExpanded(!collapse);
    try {
      window.localStorage.setItem(SIDEBAR_KEY, collapse ? '1' : '0');
    } catch {
      // Speicher nicht verfügbar – gilt nur für diese Sitzung
    }
  }, [isNarrow]);

  useEffect(() => {
    const mac = isMacPlatform();
    function onKeyDown(e: KeyboardEvent) {
      const action = matchShortcut(e, mac);
      if (!action) return;
      e.preventDefault();
      if (action === 'search') {
        // Der Suchdialog übernimmt den Fokus; ein offener Drawer würde ihn per Fokusfalle zurückholen
        setDrawerOpen(false);
        setSearchOpen((o) => !o);
      } else if (action === 'toggleSidebar') toggleSidebar();
      else if (action === 'back') window.history.back();
      else window.history.forward();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleSidebar]);

  return (
    <ToastProvider>
      <UploadProvider>
        <div className="flex h-dvh">
          <a href="#main" className="sg-skip-link">
            Zum Inhalt springen
          </a>
          {drawerOpen && (
            <div className="sg-drawer-backdrop md:hidden" aria-hidden="true" onClick={() => closeDrawer()} />
          )}
          <div
            className="contents"
            onClick={(e) => {
              if (drawerOpen && (e.target as HTMLElement).closest('#sidebar a[href]')) closeDrawer('main');
            }}
          >
            <Sidebar
              expanded={isNarrow ? drawerOpen : expanded}
              drawerOpen={drawerOpen}
              modal={modal}
              onToggle={() => (drawerOpen ? closeDrawer() : toggleSidebar())}
              onOpenSearch={() => {
                setDrawerOpen(false);
                setSearchOpen(true);
              }}
              onOpenSetup={() => {
                setDrawerOpen(false);
                setSetupRequested((n) => n + 1);
              }}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col" inert={modal}>
            <header className="flex items-center gap-2 border-b border-border bg-surface px-2 py-1 md:hidden">
              <button
                ref={menuButton}
                type="button"
                onClick={() => setDrawerOpen((o) => !o)}
                aria-expanded={drawerOpen}
                aria-controls="sidebar"
                aria-label={drawerOpen ? 'Menü schließen' : 'Menü öffnen'}
                className="sg-nav-link w-auto"
              >
                <Icon name="menu" />
              </button>
              <span className="text-sm font-semibold">Studien-Gehirn</span>
            </header>
            {sync && <OtherTabBanner client={sync} onTakeOver={noteRecordingIntent} />}
            {sync && <ErrorShelf client={sync} />}
            <div className="flex min-h-0 flex-1">
              <main
                id="main"
                tabIndex={-1}
                className={`min-w-0 flex-1 ${fullBleed ? 'overflow-hidden' : 'overflow-y-auto px-4 py-6 md:px-8 md:py-8'}`}
              >
                {fullBleed ? (
                  <div className="h-full">{children}</div>
                ) : (
                  <div className="mx-auto max-w-3xl">{children}</div>
                )}
              </main>
            </div>
            <RecordingBar />
          </div>
          <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
          <SetupHost requested={setupRequested} />
        </div>
      </UploadProvider>
    </ToastProvider>
  );
}
