// Mess-Harness für den Ink-Renderer: rendert <InkPage> mit vielen Strichen und hängt auf Anforderung Striche an.
// Wird von measure.cjs mit esbuild gebündelt; nicht Teil des App-Builds.
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { InkPage } from '../../src/components/ink/InkPage.tsx';

interface Cfg {
  strokes: never[];
  reserve: never[];
  zoom: number;
  width: number;
}
declare global {
  interface Window {
    __start: (cfg: Cfg) => void;
    __append: () => boolean;
    __measure: (frames: number, mode: 'append' | 'idle') => Promise<number[]>;
  }
}

// Immer helles Theme, sonst misst der Dunkel-Filter mit
document.documentElement.setAttribute('data-theme', 'light');

window.__start = (cfg) => {
  const host = document.getElementById('host')!;
  const root = createRoot(host);
  let current = cfg.strokes as unknown[];
  let next = 0;
  const draw = () =>
    flushSync(() => root.render(<InkPage strokes={current as never[]} width={cfg.width * cfg.zoom} />));
  draw();
  window.__append = () => {
    if (next >= cfg.reserve.length) return false;
    current = [...current, cfg.reserve[next++]];
    draw();
    return true;
  };
};

window.__measure = (frames, mode) =>
  new Promise((resolve) => {
    const out: number[] = [];
    let last = performance.now();
    let n = 0;
    const tick = (t: number) => {
      out.push(t - last);
      last = t;
      if (mode === 'append') window.__append();
      if (++n >= frames)
        resolve(out.slice(2)); // die ersten Frames verwerfen
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

// Handbetrieb (`measure.cjs --serve`): Seite öffnen, Zoom und Modus wählen, Ergebnis steht auf der Seite.
if (location.hash === '#manual') {
  const bar = document.createElement('div');
  bar.style.cssText =
    'position:fixed;top:0;right:0;z-index:9;background:#fff;padding:8px;font:13px monospace;max-width:420px';
  const out = document.createElement('pre');
  bar.append(out);
  document.body.append(bar);
  const pct = (a: number[], p: number) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
  };
  void fetch('data.json')
    .then((r) => r.json())
    .then((data: { strokes: never[]; reserve: never[]; width: number; frames: number }) => {
      for (const zoom of [1, 2]) {
        const btn = document.createElement('button');
        btn.textContent = `Zoom ${zoom} messen`;
        btn.onclick = async () => {
          document.getElementById('host')!.replaceChildren();
          window.__start({ ...data, zoom });
          await new Promise((r) => setTimeout(r, 500));
          const append = await window.__measure(data.frames, 'append');
          const idle = await window.__measure(data.frames, 'idle');
          out.textContent += `Zoom ${zoom}: append p50 ${pct(append, 50).toFixed(1)} p95 ${pct(append, 95).toFixed(1)} max ${Math.max(...append).toFixed(1)} | idle p95 ${pct(idle, 95).toFixed(1)} (ms)\n`;
        };
        bar.prepend(btn);
      }
    });
}
