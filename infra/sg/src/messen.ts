// Der Befehl `sg messen`: Messwerkzeuge für die Abnahmekriterien (docs/spezifikation/10-UMSETZUNG.md §3, Phase 2).
// Liest nur aus der Datenbank (psql), schreibt nie. Anleitung: docs/anleitungen/MESSEN.md.
import { readFileSync, statSync } from 'node:fs';
import type { SgConfig } from './config.ts';
import {
  ALIGN_USAGE,
  MAX_GOLDEN_BYTES,
  parseAlignArgs,
  parseGolden,
  runAlignmentReport,
} from './messen-ausrichtung.ts';
import { PIPELINE_USAGE, parsePipelineArgs, runPipelineReport, type MessenIo } from './messen-pipeline.ts';
import { openPg, realExec, type PgAccess } from './pg.ts';

export const MESSEN_USAGE = `${PIPELINE_USAGE}\n${ALIGN_USAGE}`;

export interface MessenDeps {
  openPg: (cfg: SgConfig) => Promise<Pick<PgAccess, 'query'>>;
  /** Liest die Datei mit dem goldenen Datensatz; wirft bei Fehlern mit lesbarer Meldung */
  readGolden: (path: string) => string;
  io: MessenIo & { err: (line: string) => void };
}

export function realMessenDeps(): MessenDeps {
  return {
    openPg: (cfg) => openPg(cfg, realExec),
    readGolden: (path) => {
      let size: number;
      try {
        size = statSync(path).size;
      } catch {
        throw new Error(`Die Datei "${path}" lässt sich nicht lesen (Pfad prüfen).`);
      }
      if (size > MAX_GOLDEN_BYTES) throw new Error(`Die Datei "${path}" ist größer als 1 MB.`);
      try {
        return readFileSync(path, 'utf8');
      } catch {
        throw new Error(`Die Datei "${path}" lässt sich nicht lesen (Pfad prüfen, kein Ordner).`);
      }
    },
    io: {
      out: (line) => console.log(line),
      err: (line) => console.error(`[sg] ${line}`),
    },
  };
}

export async function messenCommand(cfg: SgConfig, rest: string[], deps: MessenDeps): Promise<number> {
  const [sub, ...args] = rest;
  try {
    switch (sub) {
      case 'pipeline': {
        const parsed = parsePipelineArgs(args);
        if (!parsed.ok) {
          deps.io.err(`${parsed.message}\n${PIPELINE_USAGE}`);
          return 1;
        }
        return await runPipelineReport(await deps.openPg(cfg), parsed, deps.io);
      }
      case 'ausrichtung': {
        const parsed = parseAlignArgs(args);
        if (!parsed.ok) {
          deps.io.err(`${parsed.message}\n${ALIGN_USAGE}`);
          return 1;
        }
        const golden = parseGolden(deps.readGolden(parsed.file));
        if (!golden.ok) {
          deps.io.err(`Goldener Datensatz ungültig: ${golden.message} Format: docs/anleitungen/MESSEN.md`);
          return 1;
        }
        return await runAlignmentReport(await deps.openPg(cfg), golden.sessions, parsed.source, deps.io);
      }
      default:
        deps.io.err(
          sub === undefined
            ? `Unterbefehl fehlt.\n${MESSEN_USAGE}`
            : `Unbekannter Unterbefehl "${sub}".\n${MESSEN_USAGE}`,
        );
        return 1;
    }
  } catch (error) {
    deps.io.err(error instanceof Error ? error.message : 'Unbekannter Fehler.');
    return 1;
  }
}
