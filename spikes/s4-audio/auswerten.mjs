#!/usr/bin/env node
// Spike S4 – Auswertungswerkzeug für Browser-Audioaufnahme-Läufe
// Fügt Chunks je Variante (A: Init-Chunk + Stream, B: Einzeldekodierung + Stille-Ausgleich)
// per ffmpeg nach full.m4a (AAC 48 kHz mono) zusammen und analysiert Lücken, Überlappungen,
// Encoder-Priming und fehlende Chunks.

import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';

const BASE_OUTPUT_DIR = path.resolve(os.homedir(), 'StudienGehirn', 'spikes', 's4');
const LAUF_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

function hasBinary(name) {
  const res = spawnSync('which', [name], { encoding: 'utf8' });
  return res.status === 0 && Boolean(res.stdout && res.stdout.trim());
}

function findLatestLauf() {
  if (!existsSync(BASE_OUTPUT_DIR)) return null;
  const entries = readdirSync(BASE_OUTPUT_DIR)
    .filter((name) => LAUF_REGEX.test(name))
    .map((name) => {
      const full = path.resolve(BASE_OUTPUT_DIR, name);
      const manifest = path.resolve(full, 'manifest.jsonl');
      if (!existsSync(manifest)) return null;
      return { name, mtimeMs: statSync(manifest).mtimeMs };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries.length > 0 ? entries[0].name : null;
}

function validateLaufDir(lauf) {
  if (!lauf || !LAUF_REGEX.test(lauf)) return null;
  const dir = path.resolve(BASE_OUTPUT_DIR, lauf);
  const rel = path.relative(BASE_OUTPUT_DIR, dir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return dir;
}

function inspectChunkHeader(buf) {
  if (!buf || buf.length < 8) {
    return { type: 'zu-kurz', hasInitHeader: false };
  }
  // WebM / EBML Header: 0x1A 0x45 0xDF 0xA3
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { type: 'WebM-EBML (Init-Header)', hasInitHeader: true };
  }
  // WebM Cluster: 0x1F 0x43 0xB6 0x75
  if (buf[0] === 0x1f && buf[1] === 0x43 && buf[2] === 0xb6 && buf[3] === 0x75) {
    return { type: 'WebM-Cluster (Fortsetzung)', hasInitHeader: false };
  }
  // MP4 Box Name in Bytes 4..7
  const boxName = buf.subarray(4, 8).toString('ascii');
  if (boxName === 'ftyp' || boxName === 'moov') {
    return { type: `MP4-${boxName} (Init-Header)`, hasInitHeader: true };
  }
  if (boxName === 'moof' || boxName === 'mdat' || boxName === 'styp') {
    return { type: `fMP4-${boxName} (Fragment)`, hasInitHeader: false };
  }
  // Suche im Puffer nach WebM-Cluster
  for (let i = 0; i + 4 <= Math.min(buf.length, 64); i += 1) {
    if (buf[i] === 0x1f && buf[i + 1] === 0x43 && buf[i + 2] === 0xb6 && buf[i + 3] === 0x75) {
      return { type: 'WebM-Fortsetzung (Cluster)', hasInitHeader: false };
    }
  }
  return { type: 'Rohdaten-Fragment', hasInitHeader: false };
}

function median(values) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function parseSilenceDetect(stderrText) {
  const silences = [];
  const lines = String(stderrText || '').split('\n');
  let currentStart = null;
  for (const line of lines) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
    if (startMatch) {
      currentStart = Number.parseFloat(startMatch[1]);
    }
    const endMatch = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/);
    if (endMatch) {
      const endSec = Number.parseFloat(endMatch[1]);
      const durSec = Number.parseFloat(endMatch[2]);
      silences.push({
        start_s: currentStart ?? Math.max(0, endSec - durSec),
        end_s: endSec,
        duration_ms: Math.round(durSec * 1000 * 100) / 100,
      });
      currentStart = null;
    }
  }
  return silences;
}

function runFfmpegAssembleAndAnalyze(laufDir, chunks, variant, mode) {
  const ffmpegAvailable = hasBinary('ffmpeg') && hasBinary('ffprobe');
  if (!ffmpegAvailable) {
    return {
      ffmpeg_available: false,
      full_m4a_path: null,
      full_m4a_duration_s: null,
      silences: [],
      error: null,
    };
  }

  const fullM4aPath = path.resolve(laufDir, 'full.m4a');
  const tmpDir = path.resolve(laufDir, '.tmp_ffmpeg');
  mkdirSync(tmpDir, { recursive: true });

  try {
    if (variant === 'A') {
      // Gruppiere Chunks nach segment_id (Standard: 1 durchgängiger Stream mit Init-Chunk seq=0)
      const segments = new Map();
      for (const c of chunks) {
        const segId = c.segment_id ?? 0;
        if (!segments.has(segId)) segments.set(segId, []);
        segments.get(segId).push(c);
      }

      const segEntries = [...segments.entries()].sort((a, b) => a[0] - b[0]);
      const inputArgs = [];
      const filterParts = [];
      let inputIndex = 0;

      for (let idx = 0; idx < segEntries.length; idx += 1) {
        const [segId, segChunks] = segEntries[idx];
        const ext = path.extname(segChunks[0].file) || '.webm';
        const segFile = path.resolve(tmpDir, `segment_${segId}${ext}`);
        const buffers = segChunks.map((c) => readFileSync(path.resolve(laufDir, c.file)));
        writeFileSync(segFile, Buffer.concat(buffers));

        if (idx > 0) {
          const prevSegChunks = segEntries[idx - 1][1];
          const prevLast = prevSegChunks[prevSegChunks.length - 1];
          const prevEndMs = prevLast.start_ms + prevLast.duration_ms;
          const gapMs = segChunks[0].start_ms - prevEndMs;
          if (gapMs > 20) {
            const gapSec = (gapMs / 1000).toFixed(3);
            inputArgs.push('-f', 'lavfi', '-t', gapSec, '-i', 'anullsrc=r=48000:cl=mono');
            filterParts.push(`[${inputIndex}:a]`);
            inputIndex += 1;
          }
        }

        inputArgs.push('-i', segFile);
        filterParts.push(`[${inputIndex}:a]`);
        inputIndex += 1;
      }

      const ffmpegArgs = ['-y', ...inputArgs];
      if (inputIndex > 1) {
        ffmpegArgs.push(
          '-filter_complex',
          `${filterParts.join('')}concat=n=${inputIndex}:v=0:a=1[outa]`,
          '-map',
          '[outa]',
        );
      }
      ffmpegArgs.push(
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-ar',
        '48000',
        '-ac',
        '1',
        '-movflags',
        '+faststart',
        fullM4aPath,
      );

      const res = spawnSync('ffmpeg', ffmpegArgs, { encoding: 'utf8' });
      if (res.status !== 0) {
        return {
          ffmpeg_available: true,
          full_m4a_path: null,
          full_m4a_duration_s: null,
          silences: [],
          error: `ffmpeg-Fehler (Variante A): ${(res.stderr || '').slice(-300)}`,
        };
      }
    } else {
      // Variante B: Jeden Chunk einzeln dekodieren und mit Stille-Ausgleich nach Zeitstempeln zusammenfügen
      const inputArgs = [];
      const filterParts = [];
      let inputIndex = 0;

      for (let i = 0; i < chunks.length; i += 1) {
        const c = chunks[i];
        if (i > 0) {
          const prev = chunks[i - 1];
          const prevEndMs = prev.start_ms + prev.duration_ms;
          const gapMs = c.start_ms - prevEndMs;
          if (gapMs > 5) {
            const gapSec = (gapMs / 1000).toFixed(4);
            inputArgs.push('-f', 'lavfi', '-t', gapSec, '-i', 'anullsrc=r=48000:cl=mono');
            filterParts.push(`[${inputIndex}:a]`);
            inputIndex += 1;
          }
        }
        inputArgs.push('-i', path.resolve(laufDir, c.file));
        filterParts.push(`[${inputIndex}:a]`);
        inputIndex += 1;
      }

      const ffmpegArgs = ['-y', ...inputArgs];
      if (inputIndex > 1) {
        ffmpegArgs.push(
          '-filter_complex',
          `${filterParts.join('')}concat=n=${inputIndex}:v=0:a=1[outa]`,
          '-map',
          '[outa]',
        );
      }
      ffmpegArgs.push(
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-ar',
        '48000',
        '-ac',
        '1',
        '-movflags',
        '+faststart',
        fullM4aPath,
      );

      const res = spawnSync('ffmpeg', ffmpegArgs, { encoding: 'utf8' });
      if (res.status !== 0) {
        return {
          ffmpeg_available: true,
          full_m4a_path: null,
          full_m4a_duration_s: null,
          silences: [],
          error: `ffmpeg-Fehler (Variante B): ${(res.stderr || '').slice(-300)}`,
        };
      }
    }

    // Gesamtdauer von full.m4a per ffprobe bestimmen
    const probeRes = spawnSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        fullM4aPath,
      ],
      { encoding: 'utf8' },
    );
    const durationSec = probeRes.status === 0 ? Number.parseFloat((probeRes.stdout || '').trim()) : null;

    let silences = [];
    if (mode === 'sine') {
      const sdRes = spawnSync(
        'ffmpeg',
        ['-i', fullM4aPath, '-af', 'silencedetect=noise=-50dB:d=0.002', '-f', 'null', '-'],
        { encoding: 'utf8' },
      );
      silences = parseSilenceDetect(sdRes.stderr || '');
    }

    return {
      ffmpeg_available: true,
      full_m4a_path: fullM4aPath,
      full_m4a_duration_s: Number.isFinite(durationSec) ? durationSec : null,
      silences,
      error: null,
    };
  } finally {
    // Temp-Verzeichnis aufräumen
    try {
      for (const f of readdirSync(tmpDir)) {
        unlinkSync(path.resolve(tmpDir, f));
      }
    } catch {
      // ignore
    }
  }
}

function main() {
  const argv = process.argv.slice(2);
  let lauf = argv[0];
  if (!lauf || lauf === '--letzter') {
    lauf = findLatestLauf();
  }

  if (!lauf) {
    console.error(
      'Aufruf: node spikes/s4-audio/auswerten.mjs <lauf-id>\n(Oder ohne Argument für den zuletzt aufgezeichneten Lauf unter ~/StudienGehirn/spikes/s4/)',
    );
    process.exit(1);
  }

  const laufDir = validateLaufDir(lauf);
  if (!laufDir || !existsSync(laufDir)) {
    console.error(`FEHLER: Lauf-Verzeichnis nicht gefunden oder ungültige ID: ${lauf}`);
    process.exit(1);
  }

  const manifestPath = path.resolve(laufDir, 'manifest.jsonl');
  if (!existsSync(manifestPath)) {
    console.error(`FEHLER: Keine manifest.jsonl in ${laufDir} gefunden.`);
    process.exit(1);
  }

  const summaryPath = path.resolve(laufDir, 'summary.json');
  const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : {};

  const rawLines = readFileSync(manifestPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // Dedupliziere nach seq (letzter erfolgreicher Empfang gewinnt)
  const chunkMap = new Map();
  for (const line of rawLines) {
    const rec = JSON.parse(line);
    chunkMap.set(rec.seq, rec);
  }

  const chunks = [...chunkMap.values()].sort((a, b) => a.seq - b.seq);
  if (chunks.length === 0) {
    console.error('FEHLER: manifest.jsonl enthält keine Chunks.');
    process.exit(1);
  }

  const variant = summary.variant || chunks[0].variant || 'A';
  const mode = summary.mode || chunks[0].mode || 'sine';
  const mimeType = summary.mime_type || chunks[0].mime_type || 'audio/webm';

  // 1) Prüfung auf fehlende Chunks (Lückenlose Sequenz 0 .. maxSeq)
  const maxSeq = chunks[chunks.length - 1].seq;
  const expectedCount = maxSeq + 1;
  const missingSeqs = [];
  for (let s = 0; s <= maxSeq; s += 1) {
    if (!chunkMap.has(s)) {
      missingSeqs.push(s);
    } else {
      const fPath = path.resolve(laufDir, chunkMap.get(s).file);
      if (!existsSync(fPath)) {
        missingSeqs.push(s);
      }
    }
  }

  // 2) Container-Header & Zeitstempel-Grenzanalyse
  const headerTypes = [];
  const boundaryGapsMs = [];
  const primingValuesMs = [];
  let totalBytes = 0;
  let totalDurationPerfMs = 0;
  let totalDecodedDurationMs = 0;
  let decodedCount = 0;
  let retriedChunksCount = 0;
  let maxRetryCount = 0;

  for (let i = 0; i < chunks.length; i += 1) {
    const c = chunks[i];
    const fPath = path.resolve(laufDir, c.file);
    const buf = existsSync(fPath) ? readFileSync(fPath) : Buffer.alloc(0);
    totalBytes += buf.length;
    totalDurationPerfMs += c.duration_ms || 0;

    if (c.retry_count > 0) {
      retriedChunksCount += 1;
      if (c.retry_count > maxRetryCount) maxRetryCount = c.retry_count;
    }

    const hInfo = inspectChunkHeader(buf);
    headerTypes.push({ seq: c.seq, ...hInfo, size_bytes: buf.length });

    if (typeof c.decoded_duration_ms === 'number' && c.decoded_duration_ms > 0) {
      totalDecodedDurationMs += c.decoded_duration_ms;
      decodedCount += 1;
    }

    if (typeof c.leading_silence_ms === 'number' && c.leading_silence_ms >= 0) {
      primingValuesMs.push(c.leading_silence_ms);
    }

    if (i > 0) {
      const prev = chunks[i - 1];
      const prevEndPerf = prev.start_ms + prev.duration_ms;
      const perfGapMs = c.start_ms - prevEndPerf;

      // Im Sinuston-Modus berücksichtigen wir zusätzlich Leading/Trailing-Silence an der Grenze
      let signalGapMs = Math.max(0, perfGapMs);
      if (
        mode === 'sine' &&
        typeof prev.trailing_silence_ms === 'number' &&
        prev.trailing_silence_ms >= 0 &&
        typeof c.leading_silence_ms === 'number' &&
        c.leading_silence_ms >= 0
      ) {
        const boundarySilence = prev.trailing_silence_ms + c.leading_silence_ms;
        if (boundarySilence > signalGapMs) {
          signalGapMs = boundarySilence;
        }
      }

      boundaryGapsMs.push({
        boundary: `${prev.seq}->${c.seq}`,
        perf_gap_ms: Math.round(perfGapMs * 100) / 100,
        effective_gap_ms: Math.round(signalGapMs * 100) / 100,
      });
    }
  }

  // 3) Optional: ffmpeg-Zusammenführung nach full.m4a & silencedetect
  const ffmpegRes = runFfmpegAssembleAndAnalyze(laufDir, chunks, variant, mode);

  // Kombiniere erkannte Lücken (aus silencedetect in full.m4a bzw. aus Grenz-/Wellenform-Analyse)
  const effectiveGapsMs =
    ffmpegRes.ffmpeg_available && ffmpegRes.silences.length > 0
      ? ffmpegRes.silences.map((s) => s.duration_ms)
      : boundaryGapsMs.map((g) => Math.max(0, g.effective_gap_ms));

  const gapsOver20Ms = effectiveGapsMs.filter((ms) => ms > 20);
  const maxGapMs = effectiveGapsMs.length > 0 ? Math.max(...effectiveGapsMs) : 0;

  const primingMin = primingValuesMs.length > 0 ? Math.min(...primingValuesMs) : 0;
  const primingMed = primingValuesMs.length > 0 ? median(primingValuesMs) : 0;
  const primingMax = primingValuesMs.length > 0 ? Math.max(...primingValuesMs) : 0;

  const targetDurationS = summary.target_duration_ms
    ? summary.target_duration_ms / 1000
    : (chunks.length * (summary.chunk_interval_ms || 30000)) / 1000;
  const actualPerfS = summary.actual_perf_duration_ms
    ? summary.actual_perf_duration_ms / 1000
    : totalDurationPerfMs / 1000;
  const actualAudioS = summary.actual_audio_duration_ms
    ? summary.actual_audio_duration_ms / 1000
    : chunks[chunks.length - 1].audio_time_ms / 1000;

  const initHeaderCount = headerTypes.filter((h) => h.hasInitHeader).length;

  const reportData = {
    lauf,
    variant,
    mode,
    mime_type: mimeType,
    target_duration_s: Math.round(targetDurationS * 100) / 100,
    actual_perf_duration_s: Math.round(actualPerfS * 100) / 100,
    actual_audio_duration_s: Math.round(actualAudioS * 100) / 100,
    decoded_duration_s:
      decodedCount === chunks.length ? Math.round((totalDecodedDurationMs / 1000) * 100) / 100 : null,
    full_m4a_duration_s: ffmpegRes.full_m4a_duration_s,
    chunks_expected: expectedCount,
    chunks_received: chunks.length,
    missing_chunks: missingSeqs,
    init_header_chunks_count: initHeaderCount,
    total_size_bytes: totalBytes,
    idb_retried_chunks: retriedChunksCount,
    idb_max_retry_count: maxRetryCount,
    idb_peak_pending: summary.idb_peak_pending ?? 0,
    gaps_over_20ms_count: gapsOver20Ms.length,
    max_gap_ms: Math.round(maxGapMs * 100) / 100,
    encoder_priming_ms: {
      min: Math.round(primingMin * 100) / 100,
      median: Math.round(primingMed * 100) / 100,
      max: Math.round(primingMax * 100) / 100,
    },
    boundary_gaps: boundaryGapsMs,
    ffmpeg_available: ffmpegRes.ffmpeg_available,
    ffmpeg_silences: ffmpegRes.silences,
    ffmpeg_error: ffmpegRes.error,
  };

  const lines = [
    '======================================================================',
    '  SPIKE S4 – AUSWERTUNGSBERICHT (Bitte kopieren & an Claude senden)',
    '======================================================================',
    `Lauf-ID:                   ${lauf}`,
    `Variante:                  Variante ${variant} (${variant === 'A' ? 'timeslice + Init-Chunk seq=0' : 'Recorder-Rotation alle 30s'})`,
    `Modus:                     ${mode === 'sine' ? 'Sinuston 440 Hz (Lücken-Messung)' : 'Mikrofon'}`,
    `MIME-Typ:                  ${mimeType}`,
    `Browser:                   ${summary.user_agent || 'unbekannt'}`,
    '----------------------------------------------------------------------',
    '1. DAUER & VOLLSTÄNDIGKEIT',
    `   Gesamtdauer Soll:       ${reportData.target_duration_s.toFixed(2)} s`,
    `   Gesamtdauer Ist (perf): ${reportData.actual_perf_duration_s.toFixed(2)} s`,
    `   Gesamtdauer AudioCtx:   ${reportData.actual_audio_duration_s.toFixed(2)} s`,
    `   Decodierte Audiodauer:  ${reportData.decoded_duration_s !== null ? `${reportData.decoded_duration_s.toFixed(2)} s` : 'n/v'}`,
    `   full.m4a Dauer (ffmpeg):${reportData.full_m4a_duration_s !== null ? ` ${reportData.full_m4a_duration_s.toFixed(2)} s` : ' (ffmpeg nicht installiert – siehe Hinweis unten)'}`,
    `   Empfangene Chunks:      ${chunks.length} / ${expectedCount} (${(totalBytes / 1024).toFixed(1)} KB gesamt)`,
    `   Fehlende Chunks:        ${missingSeqs.length === 0 ? '0 (LÜCKENLOS)' : `FEHLER: [${missingSeqs.join(', ')}]`}`,
    `   Chunks mit Init-Header: ${initHeaderCount} von ${chunks.length} (${headerTypes[0]?.type || '–'}${chunks.length > 1 ? `, Folge-Chunk: ${headerTypes[1]?.type}` : ''})`,
    '----------------------------------------------------------------------',
    '2. CHUNK-GRENZEN, LÜCKEN & ENCODER-PRIMING',
    `   Untersuchte Grenzen:    ${boundaryGapsMs.length}`,
    `   Anzahl Lücken > 20 ms:  ${reportData.gaps_over_20ms_count}`,
    `   Größte Lücke:           ${reportData.max_gap_ms.toFixed(2)} ms`,
    `   Encoder-Priming (Start):min=${reportData.encoder_priming_ms.min.toFixed(2)} ms | median=${reportData.encoder_priming_ms.median.toFixed(2)} ms | max=${reportData.encoder_priming_ms.max.toFixed(2)} ms`,
    '----------------------------------------------------------------------',
    '3. INDEXEDDB-PUFFER (F-AUD-01) & HINTERGRUND-STABILITÄT',
    `   Peak-Puffer IndexedDB:  ${reportData.idb_peak_pending} Chunks`,
    `   Nachgesendete Chunks:   ${retriedChunksCount} (max. ${maxRetryCount} Versuche pro Chunk)`,
    `   Screen Wake Lock:       ${summary.wake_lock_status || '–'} (Freigaben: ${summary.wake_lock_drops ?? 0}×)`,
    `   Tab im Hintergrund:     ${summary.bg_switch_count ?? 0}× (${((summary.bg_total_ms || 0) / 1000).toFixed(1)} s)`,
    `   Ruhezustands-Sprünge:   ${summary.sleep_jumps_detected ?? 0}`,
  ];

  if (!ffmpegRes.ffmpeg_available) {
    lines.push(
      '----------------------------------------------------------------------',
      'HINWEIS ZU FFMPEG:',
      '   ffmpeg/ffprobe wurde im PATH nicht gefunden. Die obigen Werte stammen',
      '   aus der direkten Container-, Zeitstempel- und WebAudio-PCM-Analyse.',
      '   Für die zusätzliche Transcodierung nach full.m4a (AAC 48 kHz mono):',
      '     brew install ffmpeg && node spikes/s4-audio/auswerten.mjs ' + lauf,
    );
  } else if (ffmpegRes.error) {
    lines.push('----------------------------------------------------------------------');
    lines.push(`WARNUNG (ffmpeg): ${ffmpegRes.error}`);
  } else {
    lines.push('----------------------------------------------------------------------');
    lines.push(`Ausgabedatei (AAC 48 kHz mono): ${ffmpegRes.full_m4a_path}`);
  }

  lines.push('======================================================================');

  const reportText = `${lines.join('\n')}\n`;
  writeFileSync(path.resolve(laufDir, 'auswertung.txt'), reportText, 'utf8');
  writeFileSync(path.resolve(laufDir, 'auswertung.json'), `${JSON.stringify(reportData, null, 2)}\n`, 'utf8');

  process.stdout.write(reportText);
}

main();
