'use client';
// App-weit ungesendete Chunks nachholen (Issue #115): Nur der Leader-Tab lädt hoch. Läuft ab dem App-Start, auch ohne
// Besuch des Live-Dashboards. Beim Leader-Wechsel übernimmt der neue Leader. Ein Tab, der nicht mehr Leader ist,
// meldet über den BroadcastChannel „Chunks liegen bereit“ (`kick`), damit der Leader sie holt.
import { useEffect } from 'react';
import type { SyncClient } from '../sync/client.ts';
import { isLeaderState, useConnectionState } from './leader-state.ts';
import { isRecordingActive } from './recorder.ts';
import { createDefaultRecorderStore } from './store.ts';
import type { RecorderStore } from './types.ts';
import { ChunkUploader, type UploaderOptions } from './uploader.ts';

export const UPLOAD_CHANNEL = 'sg-recorder-uploads';

/** Meldet dem Leader, dass in IndexedDB Chunks bereitliegen (z. B. nach dem Stopp eines Ex-Leaders) */
export function notifyUploadsPending(name = UPLOAD_CHANNEL): void {
  try {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(name);
    channel.postMessage('kick');
    channel.close();
  } catch {
    // Kanal nicht verfügbar
  }
}

export interface ResumeUploadsOptions {
  /** Nur für Tests */
  store?: RecorderStore;
  uploader?: Omit<UploaderOptions, 'store' | 'isActive'>;
  channelName?: string;
}

export function useResumePendingUploads(client: SyncClient | null, options: ResumeUploadsOptions = {}): void {
  const leader = isLeaderState(useConnectionState(client));
  const { store, uploader: uploaderOptions, channelName } = options;
  useEffect(() => {
    if (!leader) return;
    const uploader = new ChunkUploader({
      ...uploaderOptions,
      store: store ?? createDefaultRecorderStore(),
      isActive: isRecordingActive,
    });
    uploader.kick();
    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel(channelName ?? UPLOAD_CHANNEL);
        channel.onmessage = () => uploader.kick();
      }
    } catch {
      channel = null;
    }
    const onOnline = () => uploader.retryNow();
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
      channel?.close();
      uploader.dispose();
    };
  }, [leader, store, uploaderOptions, channelName]);
}
