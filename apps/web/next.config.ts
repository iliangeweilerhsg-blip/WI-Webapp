import type { NextConfig } from 'next';

const config: NextConfig = {
  // Static Export nach apps/web/out – der Core liefert die Dateien aus (VERTRAEGE §1/§5)
  output: 'export',
  // @sg/shared exportiert TypeScript-Quellen (ENTWICKLUNG.md)
  transpilePackages: ['@sg/shared'],
  reactStrictMode: true,
  images: { unoptimized: true },
  // Linting läuft zentral über das Root-ESLint (pnpm lint), nicht im Next-Build
  eslint: { ignoreDuringBuilds: true },
};

export default config;
