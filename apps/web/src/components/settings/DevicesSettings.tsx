'use client';

import { useContext, useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Device, PairingCode, PairingRequest } from '@sg/shared';
import {
  closePairingWindow,
  devicesErrorMessage,
  formatAbsolute,
  formatLastSeen,
  formatRemaining,
  groupCode,
  isNewDevice,
  remainingAnnouncement,
  removeDeviceNow,
  useDevices,
  useOpenPairing,
  usePairingSnapshot,
  useRejectRequest,
  useRemoveDevice,
  type PairingSnapshot,
} from '../../lib/devices.ts';
import { useToast } from '../../lib/toast.tsx';
import { CoreHint } from '../CoreHint.tsx';
import { SettingsTabContext } from './form.tsx';
import { PairingQr } from './PairingQr.tsx';

const smallButton =
  'rounded-md border border-border px-3 py-1 text-sm hover:bg-surface disabled:opacity-50 sg-transition';
const primaryButton =
  'rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast disabled:opacity-50 sg-transition';

const KIND_LABEL: Record<Device['kind'], string> = { ipad: 'iPad', iphone: 'iPhone' };

/** Sekundentakt, solange `active` */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function DeviceRow({
  device,
  busy,
  onRemove,
}: {
  device: Device;
  busy: boolean;
  onRemove: (device: Device) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const hintId = useId();

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  function cancel() {
    setConfirming(false);
    // Nach dem Rendern steht „Entfernen“ wieder da
    requestAnimationFrame(() => removeRef.current?.focus());
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <span className="font-medium break-words">{device.name}</span>
          <span className="ml-2 text-sm text-text-muted">{KIND_LABEL[device.kind]}</span>
          {isNewDevice(device) ? (
            <span className="ml-2 inline-block rounded-sm border border-border-strong px-1.5 text-xs font-medium">
              Neu gekoppelt
            </span>
          ) : null}
          {device.connected ? (
            <span className="ml-2 inline-flex items-center gap-1 text-sm">
              <span aria-hidden="true" className="inline-block size-2 rounded-full bg-accent" />
              verbunden
            </span>
          ) : null}
          <p className="mt-0.5 text-sm text-text-muted">
            Zuletzt gesehen:{' '}
            {device.last_seen_at ? (
              <time dateTime={device.last_seen_at} title={formatAbsolute(device.last_seen_at)}>
                {formatLastSeen(device.last_seen_at)}
              </time>
            ) : (
              'noch nie'
            )}
          </p>
          {isNewDevice(device) ? (
            <p className="mt-0.5 text-sm text-text-muted">
              Gekoppelt{' '}
              <time dateTime={device.created_at} title={formatAbsolute(device.created_at)}>
                {formatLastSeen(device.created_at)}
              </time>
              . Kennst du es nicht? Entferne es.
            </p>
          ) : null}
        </div>
        <div
          className="flex flex-wrap justify-end gap-2"
          onKeyDown={(e) => {
            if (confirming && e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
        >
          {confirming ? (
            <>
              <button
                ref={confirmRef}
                type="button"
                disabled={busy}
                aria-describedby={hintId}
                onClick={() => {
                  setConfirming(false);
                  onRemove(device);
                }}
                aria-label={`Ja, entfernen: ${device.name}`}
                className={`${smallButton} border-danger text-danger`}
              >
                Ja, entfernen
              </button>
              <button type="button" onClick={cancel} className={smallButton}>
                Abbrechen
              </button>
            </>
          ) : (
            <button
              ref={removeRef}
              type="button"
              disabled={busy}
              aria-label={`Entfernen: ${device.name}`}
              onClick={() => setConfirming(true)}
              className={smallButton}
            >
              Entfernen
            </button>
          )}
        </div>
      </div>
      {confirming ? (
        <p id={hintId} className="mt-2 text-sm text-text-muted">
          Das Gerät verliert sofort den Zugang und wird getrennt. Um es wieder zu nutzen, musst du es neu
          koppeln. Daten auf dem Mac bleiben erhalten.
        </p>
      ) : null}
    </li>
  );
}

function RequestRow({
  request,
  busy,
  onReject,
}: {
  request: PairingRequest;
  busy: boolean;
  onReject: (request: PairingRequest) => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div className="min-w-0">
        <span className="font-medium break-words">{request.device_name}</span>
        <span className="ml-2 text-sm text-text-muted">
          {KIND_LABEL[request.kind]} · angefragt {formatLastSeen(request.requested_at)}
        </span>
      </div>
      <button
        type="button"
        disabled={busy}
        aria-label={`Ablehnen: ${request.device_name}`}
        onClick={() => onReject(request)}
        className={smallButton}
      >
        Ablehnen
      </button>
    </li>
  );
}

type PanelProblem = 'expired' | 'failures' | 'qr_only' | 'replaced' | null;

/** Was die Web-App zum Fenster `code` anzeigt, aus Zustand des Core und lokaler Restzeit */
function problemOf(
  code: PairingCode,
  snapshot: PairingSnapshot | undefined,
  remainingMs: number,
): PanelProblem {
  if (snapshot?.state === 'locked' || snapshot?.state === 'closed_failures') return 'failures';
  if (snapshot && snapshot.state !== 'unknown' && snapshot.pairingId !== code.pairing_id) return 'replaced';
  if (snapshot?.state === 'closed') return 'replaced';
  if (remainingMs <= 0 || snapshot?.state === 'expired') return 'expired';
  if (snapshot?.state === 'qr_only') return 'qr_only';
  return null;
}

const NETWORK_HINT =
  'Stört jemand im selben WLAN, koppele in einem anderen Netz, zum Beispiel im Heim-WLAN oder über den Hotspot deines iPhones.';

function PairingPanel({
  code,
  polling,
  opening,
  onRenew,
  onClose,
  onPaired,
}: {
  code: PairingCode;
  polling: boolean;
  opening: boolean;
  onRenew: () => void;
  onClose: () => void;
  onPaired: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const now = useNow(true);
  const remaining = Date.parse(code.expires_at) - now;
  const snapshot = usePairingSnapshot(polling && remaining > -5_000);
  const reject = useRejectRequest();
  const toast = useToast();
  const [announcement, setAnnouncement] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);
  const seenRequests = useRef<Set<string>>(new Set());
  const problem = problemOf(code, snapshot.data, remaining);
  const requests = problem === 'replaced' || problem === 'failures' ? [] : (snapshot.data?.requests ?? []);
  const pairedFired = useRef(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, [code.pairing_id]);

  // Sparsame Ansage der Restzeit (volle Minuten, 30 s, Ablauf)
  useEffect(() => {
    const text = remainingAnnouncement(remaining);
    if (text) setAnnouncement((old) => (old === text ? old : text));
  }, [remaining]);

  // Neue Anfrage über das Netzwerk: einmal ansagen
  const incoming = snapshot.data?.requests;
  useEffect(() => {
    for (const request of incoming ?? []) {
      if (seenRequests.current.has(request.request_id)) continue;
      seenRequests.current.add(request.request_id);
      setAnnouncement(`Neue Kopplungsanfrage von „${request.device_name}“.`);
    }
  }, [incoming]);

  // Erfolg: das Fenster dieses Codes ist gekoppelt (genau einmal melden)
  const paired = snapshot.data?.state === 'paired' && snapshot.data.pairingId === code.pairing_id;
  useEffect(() => {
    if (paired && !pairedFired.current) {
      pairedFired.current = true;
      onPaired();
    }
  }, [paired, onPaired]);

  async function onReject(request: PairingRequest) {
    setRejectError(null);
    try {
      await reject.mutateAsync(request.request_id);
      toast.show({ message: `Anfrage von „${request.device_name}“ abgelehnt` });
    } catch (failure) {
      setRejectError(devicesErrorMessage(failure));
    }
  }

  const closed = problem === 'expired' || problem === 'failures' || problem === 'replaced';

  return (
    <section aria-labelledby={headingId} className="mt-4 rounded-lg border border-border-strong p-4">
      <h3 id={headingId} ref={headingRef} tabIndex={-1} className="text-md font-medium focus:outline-none">
        iPad koppeln
      </h3>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {closed ? (
        <div role="status" className="mt-3 rounded-md border border-border bg-surface px-3 py-2 text-sm">
          {problem === 'expired' ? (
            <p>Der Code ist abgelaufen. Erzeuge einen neuen, um weiter zu koppeln.</p>
          ) : problem === 'failures' ? (
            <>
              <p className="font-medium">Viele Fehlversuche – die Kopplung ist vorerst gesperrt.</p>
              <p className="mt-1">
                Jemand hat mehrfach falsche Codes eingegeben. {NETWORK_HINT} Ein neuer Code hebt die Sperre
                auf.
              </p>
            </>
          ) : (
            <p>
              Dieses Kopplungsfenster gilt nicht mehr: Es wurde an anderer Stelle neu geöffnet, oder der Core
              ist neu gestartet.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={onRenew} disabled={opening} className={primaryButton}>
              {opening ? 'Wird erzeugt …' : 'Neuen Code erzeugen'}
            </button>
            <button type="button" onClick={onClose} className={smallButton}>
              Schließen
            </button>
          </div>
        </div>
      ) : (
        <>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-text-muted">
            <li>Öffne Studien-Gehirn auf dem iPad und wähle „Mit Mac koppeln“.</li>
            <li>Scanne den QR-Code. Das ist der sichere Weg.</li>
            <li>Ohne Kamera: Tippe Adresse und Code von Hand ein.</li>
          </ol>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="w-full max-w-60 shrink-0 rounded-lg border border-border bg-white p-2 sm:w-60">
              <PairingQr value={code.qr_url} label="QR-Code zum Koppeln des iPads" size={208} />
            </div>
            <dl className="min-w-0 space-y-3 text-sm">
              <div>
                <dt className="text-text-muted">Code</dt>
                <dd
                  className="font-mono text-xxl font-semibold tracking-widest"
                  aria-label={`Code ${code.code.split('').join(' ')}`}
                >
                  {groupCode(code.code)}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">Adresse</dt>
                <dd className="font-mono break-all">{code.host}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Port</dt>
                <dd className="font-mono">{code.port}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Gültig noch</dt>
                <dd>
                  <time className="font-mono tabular-nums" dateTime={code.expires_at}>
                    {formatRemaining(remaining)}
                  </time>
                </dd>
              </div>
            </dl>
          </div>

          {problem === 'qr_only' ? (
            <div role="status" className="mt-4 rounded-md border border-border bg-surface px-3 py-2 text-sm">
              <p className="font-medium">Viele falsche Codes über das Netzwerk.</p>
              <p className="mt-1">
                Die Eingabe von Hand ist für diesen Code gesperrt. Der QR-Code funktioniert weiter.{' '}
                {NETWORK_HINT}
              </p>
            </div>
          ) : null}

          {requests.length > 0 ? (
            <div className="mt-4">
              <h4 className="text-sm font-medium">Anfragen über das Netzwerk</h4>
              <p className="mt-1 text-sm text-text-muted">
                Name und Absender sind nicht geprüft, jeder im WLAN kann sich so nennen. Koppele am besten per
                QR-Code und lehne Anfragen ab, die du nicht kennst.
              </p>
              <ul aria-label="Offene Kopplungsanfragen" className="mt-1 divide-y divide-border">
                {requests.map((request) => (
                  <RequestRow
                    key={request.request_id}
                    request={request}
                    busy={reject.isPending}
                    onReject={onReject}
                  />
                ))}
              </ul>
            </div>
          ) : null}
          {rejectError ? (
            <p role="alert" className="mt-2 text-sm font-medium">
              <span aria-hidden="true">⚠ </span>
              {rejectError}
            </p>
          ) : null}
          {snapshot.isError ? (
            <div className="mt-3">
              <CoreHint error={snapshot.error} />
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={onRenew} disabled={opening} className={smallButton}>
              {opening ? 'Wird erzeugt …' : 'Neuen Code erzeugen'}
            </button>
            <button type="button" onClick={onClose} className={smallButton}>
              Schließen
            </button>
          </div>
          <p className="mt-2 text-xs text-text-muted">
            Der Code gilt nur in diesem Fenster und höchstens 5 Minuten. Ein neuer Code macht den alten
            ungültig.
          </p>
        </>
      )}
    </section>
  );
}

/**
 * Einstellungen → Geräte (T1-10, VERTRAEGE §7.5 und §12): gekoppelte Geräte mit „Entfernen“, Kopplung per
 * QR-Code oder Code mit Countdown, offene Anfragen aus dem Netzwerk mit „Ablehnen“.
 */
export function DevicesSettings() {
  const { active } = useContext(SettingsTabContext);
  const devices = useDevices();
  const remove = useRemoveDevice();
  const open = useOpenPairing();
  const toast = useToast();
  const client = useQueryClient();
  const [code, setCode] = useState<PairingCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Geräte-IDs beim Öffnen des Fensters: so ist nach der Kopplung klar, welches Gerät neu ist */
  const knownIds = useRef<Set<string>>(new Set());
  /** Fenster, die schon gekoppelt haben (nicht mehr schließen) */
  const pairedIds = useRef<Set<string>>(new Set());

  // Ein offenes Fenster wird am Core geschlossen, sobald es hier nicht mehr angezeigt wird: beim Ersetzen durch
  // einen neuen Code (dann ist es dort schon ersetzt, der Aufruf ist harmlos), beim Verlassen der Ansicht und beim
  // Schließen oder Neuladen des Tabs. So bleibt kein abfotografierter Code bis zum Ablauf gültig.
  const pairingId = code?.pairing_id ?? null;
  const pendingClose = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  useEffect(() => {
    if (!pairingId) return;
    // React (Strict Mode) baut Effekte in der Entwicklung einmal ab und sofort wieder auf: ein dafür geplantes
    // Schließen desselben Fensters wird hier wieder verworfen
    if (pendingClose.current?.id === pairingId) {
      clearTimeout(pendingClose.current.timer);
      pendingClose.current = null;
    }
    const close = () => {
      if (!pairedIds.current.has(pairingId)) void closePairingWindow(pairingId).catch(() => {});
    };
    window.addEventListener('pagehide', close);
    return () => {
      window.removeEventListener('pagehide', close);
      pendingClose.current = { id: pairingId, timer: setTimeout(close, 0) };
    };
  }, [pairingId]);
  const pairButton = useRef<HTMLButtonElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const listHeadingId = useId();

  async function startPairing() {
    setError(null);
    try {
      knownIds.current = new Set((devices.data ?? []).map((d) => d.id));
      setCode(await open.mutateAsync());
    } catch (failure) {
      setError(devicesErrorMessage(failure));
    }
  }

  function closePanel() {
    // Das Schließen am Core übernimmt der Effekt oben (Fenster wird nicht mehr angezeigt)
    setCode(null);
    requestAnimationFrame(() => pairButton.current?.focus());
  }

  const onPaired = useRef(() => {});
  onPaired.current = () => {
    if (code) pairedIds.current.add(code.pairing_id);
    setCode(null);
    requestAnimationFrame(() => listHeading.current?.focus());
    void (async () => {
      const list = (await devices.refetch()).data ?? [];
      const added = list.filter((d) => !knownIds.current.has(d.id));
      const device = added.at(-1);
      if (!device) {
        toast.show({ message: 'Gerät gekoppelt' });
        return;
      }
      // Name und Art nennen und das Entfernen direkt anbieten: Wer Code oder QR-Code abfotografiert hat, soll
      // nicht unbemerkt gekoppelt bleiben
      toast.show({
        message: `„${device.name}“ (${KIND_LABEL[device.kind]}) wurde gekoppelt. Nicht du?`,
        actionLabel: 'Entfernen',
        durationMs: 20_000,
        onAction: () => {
          removeDeviceNow(client, device.id)
            .then(() => toast.show({ message: `${device.name} entfernt` }))
            .catch((failure: unknown) => toast.show({ message: devicesErrorMessage(failure) }));
        },
      });
    })();
  };

  async function onRemove(device: Device) {
    setError(null);
    try {
      await remove.mutateAsync(device.id);
      toast.show({ message: `${device.name} entfernt` });
      requestAnimationFrame(() => listHeading.current?.focus());
    } catch (failure) {
      setError(devicesErrorMessage(failure));
    }
  }

  return (
    <section aria-labelledby={headingId} className="mt-6 rounded-lg border border-border p-4">
      <h2 id={headingId} className="text-lg font-medium">
        Geräte
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        Das iPad verbindet sich über das WLAN mit diesem Mac. Gekoppelte Geräte haben vollen Zugriff auf deine
        Daten.
      </p>

      {devices.isError ? (
        <div className="mt-3">
          <CoreHint error={devices.error} />
        </div>
      ) : null}

      <h3
        id={listHeadingId}
        ref={listHeading}
        tabIndex={-1}
        className="mt-4 text-md font-medium focus:outline-none"
      >
        Gekoppelte Geräte
      </h3>
      {devices.isPending ? (
        <p role="status" className="mt-2 text-sm text-text-muted">
          Geräte werden geladen …
        </p>
      ) : devices.data && devices.data.length > 0 ? (
        <ul aria-labelledby={listHeadingId} className="mt-1 divide-y divide-border">
          {devices.data.map((device) => (
            <DeviceRow key={device.id} device={device} busy={remove.isPending} onRemove={onRemove} />
          ))}
        </ul>
      ) : devices.isSuccess ? (
        <p className="mt-2 text-sm text-text-muted">Noch kein Gerät gekoppelt.</p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      ) : null}

      {code ? (
        <PairingPanel
          code={code}
          polling={active}
          opening={open.isPending}
          onRenew={() => void startPairing()}
          onClose={closePanel}
          onPaired={() => onPaired.current()}
        />
      ) : (
        <div className="mt-4">
          <button
            ref={pairButton}
            type="button"
            onClick={() => void startPairing()}
            disabled={open.isPending}
            className={primaryButton}
          >
            {open.isPending ? 'Wird geöffnet …' : 'iPad koppeln'}
          </button>
        </div>
      )}
    </section>
  );
}
