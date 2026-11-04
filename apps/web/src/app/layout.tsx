import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '../components/AppShell.tsx';
import { QueryProvider } from '../lib/query.tsx';
import { THEME_INIT_SCRIPT, ThemeProvider } from '../lib/theme.tsx';
import './globals.css';

export const metadata: Metadata = {
  title: 'Studien-Gehirn',
  description: 'Vorlesung, Notizen und Lernen an einem Ort',
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <QueryProvider>
            <AppShell>{children}</AppShell>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
