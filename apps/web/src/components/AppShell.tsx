'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { isMacPlatform, matchShortcut } from '../lib/shortcuts.ts';
import { SIDEBAR_KEY } from '../lib/theme.tsx';
import { ToastProvider } from '../lib/toast.tsx';
import { UploadProvider } from '../lib/uploads.tsx';
import { SearchDialog } from './SearchDialog.tsx';
import { SetupHost } from './SetupHost.tsx';
import { Sidebar } from './Sidebar.tsx';

/** App-Rahmen (07 §2): einklappbare Seitenleiste, Inhalt, globale Kürzel. */
export function AppShell({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [setupRequested, setSetupRequested] = useState(0);
  // Die PDF-Anzeige (F-ORG-04) nutzt die ganze Fläche und scrollt selbst
  const fullBleed = usePathname() === '/dokument';

  useEffect(() => {
    const root = document.documentElement;
    setExpanded(root.getAttribute('data-sidebar') !== 'collapsed');
    // Übergang erst nach dem ersten Rendern erlauben, damit die Leiste beim Laden nicht „fährt"
    const id = requestAnimationFrame(() => root.setAttribute('data-ready', ''));
    return () => cancelAnimationFrame(id);
  }, []);

  const toggleSidebar = useCallback(() => {
    const root = document.documentElement;
    const collapse = root.getAttribute('data-sidebar') !== 'collapsed';
    if (collapse) root.setAttribute('data-sidebar', 'collapsed');
    else root.removeAttribute('data-sidebar');
    setExpanded(!collapse);
    try {
      window.localStorage.setItem(SIDEBAR_KEY, collapse ? '1' : '0');
    } catch {
      // Speicher nicht verfügbar – gilt nur für diese Sitzung
    }
  }, []);

  useEffect(() => {
    const mac = isMacPlatform();
    function onKeyDown(e: KeyboardEvent) {
      const action = matchShortcut(e, mac);
      if (!action) return;
      e.preventDefault();
      if (action === 'search') setSearchOpen((o) => !o);
      else if (action === 'toggleSidebar') toggleSidebar();
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
          <Sidebar
            expanded={expanded}
            onToggle={toggleSidebar}
            onOpenSearch={() => setSearchOpen(true)}
            onOpenSetup={() => setSetupRequested((n) => n + 1)}
          />
          <main
            id="main"
            tabIndex={-1}
            className={`min-w-0 flex-1 ${fullBleed ? 'overflow-hidden' : 'overflow-y-auto px-8 py-8'}`}
          >
            {fullBleed ? (
              <div className="h-full">{children}</div>
            ) : (
              <div className="mx-auto max-w-3xl">{children}</div>
            )}
          </main>
          <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
          <SetupHost requested={setupRequested} />
        </div>
      </UploadProvider>
    </ToastProvider>
  );
}
