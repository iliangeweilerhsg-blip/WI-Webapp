// Dünne Hülle um pdf.js (F-ORG-04). Die Oberfläche kennt nur diese Schnittstelle; pdf.js selbst wird erst
// geladen, wenn ein Dokument geöffnet wird (dynamischer Import: kein Gewicht für die übrigen Bildschirme).
// Der Worker liegt lokal im Export (kein CDN): `new URL(…, import.meta.url)` lässt Next ihn mit ausliefern.

/** Ein Textstück einer Seite. Koordinaten in PDF-Punkten (pt), Ursprung oben links. */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Zeilenende laut pdf.js (`hasEOL`): Danach beginnt eine neue Zeile. */
  eol?: boolean;
}

export interface PdfDoc {
  numPages: number;
  /** Seitengröße in pt */
  pageSize(page: number): Promise<{ width: number; height: number }>;
  textItems(page: number): Promise<PdfTextItem[]>;
  /**
   * Zeichnet die Seite so, dass sie `cssWidth` CSS-Pixel breit ist (mit Pixeldichte des Geräts).
   * `false`, wenn der Vorgang abgebrochen wurde (neuer Zoom, Seitenwechsel): Dann ist nichts fertig.
   */
  render(page: number, canvas: HTMLCanvasElement, cssWidth: number, signal?: AbortSignal): Promise<boolean>;
  destroy(): void;
}

/** Größte Breite der Zeichenfläche in Gerätepixeln (Speicher schonen bei starkem Zoom) */
const MAX_CANVAS_WIDTH = 4096;

/** Beiwerk von pdf.js (JPX/JBIG2-wasm, Standardschriften, CMaps, Farbprofile): `scripts/copy-pdfjs-assets.mjs` legt es beim Build lokal ab. */
function assetBase(version: string): string {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return `${basePath.replace(/\/+$/, '')}/pdfjs/${version}/`;
}

/** Wie oft das Anlegen des Workers schon gescheitert ist (Zähler für den Cache-Buster). */
let workerFailures = 0;

/** Adresse des Workers. Nach einem gescheiterten Start mit Cache-Buster: Chrome cacht einen gescheiterten Modul-Import. */
export function workerSource(failures: number): string {
  // Der Bundler ersetzt `new URL(…, import.meta.url)` durch ein eigenes Objekt, dessen `searchParams` die Adresse nicht
  // ändern: Der Cache-Buster wird darum an den fertigen Text gehängt.
  const href = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  return failures > 0 ? `${href}${href.includes('?') ? '&' : '?'}retry=${failures}` : href;
}

/**
 * Legt den Worker selbst an und wartet, bis er meldet, dass er läuft. pdf.js würde bei einem Worker, der nicht startet,
 * dauerhaft in den „Fake-Worker“-Modus fallen und `workerSrc` danach nie mehr lesen: Ein Neuversuch käme nie an.
 * Scheitert der Start, merken wir uns das für den Cache-Buster des nächsten Versuchs.
 */
function startWorker(
  pdfjs: typeof import('pdfjs-dist'),
): Promise<{ worker: Worker; pdfWorker: InstanceType<typeof import('pdfjs-dist').PDFWorker> }> {
  const worker = new Worker(workerSource(workerFailures), { type: 'module' });
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    const onMessage = () => {
      cleanup();
      resolve({ worker, pdfWorker });
    };
    const onError = (event: Event) => {
      cleanup();
      pdfWorker.destroy();
      worker.terminate();
      workerFailures += 1;
      reject(Object.assign(new Error('Der PDF-Worker ist nicht gestartet.'), { cause: event }));
    };
    // Zuerst unser Zuhörer, dann erst pdf.js: Die „bereit“-Nachricht erreicht beide
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    const pdfWorker = pdfjs.PDFWorker.create({ port: worker });
  });
}

export async function openPdf(url: string): Promise<PdfDoc> {
  const pdfjs = await import('pdfjs-dist');
  const { worker, pdfWorker } = await startWorker(pdfjs);
  const base = assetBase(pdfjs.version);
  const task = pdfjs.getDocument({
    url,
    worker: pdfWorker,
    wasmUrl: `${base}wasm/`,
    standardFontDataUrl: `${base}standard_fonts/`,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    iccUrl: `${base}iccs/`,
  });
  const stop = () => {
    pdfWorker.destroy();
    worker.terminate();
  };
  const doc = await task.promise.catch((error: unknown) => {
    void task.destroy();
    stop();
    throw error;
  });

  // Zeichnen läuft strikt nacheinander: Ein Canvas verträgt nur einen render()-Vorgang, und ein überholter
  // Vorgang muss erst beendet sein, bevor der nächste anfängt.
  let queue: Promise<unknown> = Promise.resolve();
  let active: { cancel: () => void } | null = null;

  async function draw(
    number: number,
    canvas: HTMLCanvasElement,
    cssWidth: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (signal?.aborted) return false;
    const page = await doc.getPage(number);
    try {
      if (signal?.aborted) return false;
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
      const pixelWidth = Math.min(cssWidth * dpr, MAX_CANVAS_WIDTH);
      const viewport = page.getViewport({ scale: pixelWidth / base.width });
      const context = canvas.getContext('2d');
      if (!context) return false;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const render = page.render({ canvas, canvasContext: context, viewport });
      active = { cancel: () => render.cancel() };
      const onAbort = () => render.cancel();
      signal?.addEventListener('abort', onAbort);
      if (signal?.aborted) render.cancel();
      try {
        await render.promise;
        return !signal?.aborted;
      } catch (error) {
        // Abbruch durch neuen Zoom oder Seitenwechsel ist kein Fehler, alles andere schon
        if ((error as { name?: string }).name === 'RenderingCancelledException') return false;
        throw error;
      } finally {
        signal?.removeEventListener('abort', onAbort);
        active = null;
      }
    } finally {
      page.cleanup();
    }
  }

  return {
    numPages: doc.numPages,

    async pageSize(number) {
      const page = await doc.getPage(number);
      const view = page.getViewport({ scale: 1 });
      // Die Größe steht fest, die Seite wird nicht mehr gebraucht (bei langen Dokumenten sonst alle im Speicher).
      // pdf.js räumt erst auf, wenn kein Zeichenvorgang dieser Seite mehr läuft: Die Zeichenschlange bleibt ungestört.
      page.cleanup();
      return { width: view.width, height: view.height };
    },

    async textItems(number) {
      const page = await doc.getPage(number);
      const view = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        // Leere Stücke und Leerzeichen bleiben erhalten: Sie sind die einzigen Hinweise auf Wort- und Zeilengrenzen
        // (die Suche braucht sie, Treffer darauf gibt es nicht). Schrift-Normalisierung (Ligaturen, NFKC) macht
        // pdf.js selbst: `disableNormalization` bleibt auf dem Standard `false`.
        if (item.str === '' && !item.hasEOL) continue;
        const [, , , , x = 0, y = 0] = pdfjs.Util.transform(view.transform, item.transform);
        const entry: PdfTextItem = { str: item.str, x, y: y - item.height, w: item.width, h: item.height };
        if (item.hasEOL) entry.eol = true;
        items.push(entry);
      }
      return items;
    },

    render(number, canvas, cssWidth, signal) {
      active?.cancel();
      const run = queue.then(() => draw(number, canvas, cssWidth, signal));
      queue = run.catch(() => {});
      return run;
    },

    destroy() {
      active?.cancel();
      void task.destroy();
      stop();
    },
  };
}
