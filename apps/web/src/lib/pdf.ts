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

export async function openPdf(url: string): Promise<PdfDoc> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
  }
  const task = pdfjs.getDocument({ url });
  const doc = await task.promise;

  return {
    numPages: doc.numPages,

    async pageSize(number) {
      const page = await doc.getPage(number);
      const view = page.getViewport({ scale: 1 });
      return { width: view.width, height: view.height };
    },

    async textItems(number) {
      const page = await doc.getPage(number);
      const view = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const item of content.items) {
        if (!('str' in item) || item.str.trim() === '') continue;
        const [, , , , x = 0, y = 0] = pdfjs.Util.transform(view.transform, item.transform);
        items.push({ str: item.str, x, y: y - item.height, w: item.width, h: item.height });
      }
      return items;
    },

    async render(number, canvas, cssWidth, signal) {
      const page = await doc.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
      const pixelWidth = Math.min(cssWidth * dpr, MAX_CANVAS_WIDTH);
      const viewport = page.getViewport({ scale: pixelWidth / base.width });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) return false;
      const render = page.render({ canvas, canvasContext: context, viewport });
      const cancel = () => render.cancel();
      signal?.addEventListener('abort', cancel);
      try {
        await render.promise;
        return !signal?.aborted;
      } catch (error) {
        // Abbruch durch neuen Zoom oder Seitenwechsel ist kein Fehler
        if ((error as { name?: string }).name === 'RenderingCancelledException') return false;
        throw error;
      } finally {
        signal?.removeEventListener('abort', cancel);
        page.cleanup();
      }
    },

    destroy() {
      void task.destroy();
    },
  };
}
