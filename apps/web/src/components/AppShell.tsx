'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { matchShortcut } from '../lib/shortcuts.ts';
import { SearchDialog } from './SearchDialog.tsx';
import { Sidebar } from './Sidebar.tsx';

const SIDEBAR_KEY = 'sg-sidebar-collapsed';

/** App-Rahmen (07 §2): einklappbare Seitenleiste, Inhalt, globale Kürzel. */
export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(SIDEBAR_KEY) === '1') setCollapsed(true);
    } catch {
      // Speicher nicht verfügbar – Standard bleibt ausgeklappt
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
      } catch {
        // egal
      }
      return next;
    });
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const action = matchShortcut(e);
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
    <div className="flex h-dvh">
      <a href="#main" className="sg-skip-link">
        Zum Inhalt springen
      </a>
      <Sidebar collapsed={collapsed} onToggle={toggleSidebar} onOpenSearch={() => setSearchOpen(true)} />
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto px-8 py-8">
        <div className="mx-auto max-w-3xl">{children}</div>
      </main>
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
