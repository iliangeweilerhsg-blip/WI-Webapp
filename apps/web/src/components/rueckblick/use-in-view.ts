'use client';

// Ist das Element (fast) im Bild? Für Notizseiten: Nur sichtbare Seiten laden Striche und zeichnen (#79). Der Beobachter
// wird beim Abräumen getrennt. Ohne `IntersectionObserver` (alte Umgebung, Tests) gilt das Element als sichtbar.
import { useCallback, useEffect, useState } from 'react';

export function useInView<T extends Element>(rootMargin = '400px 0px'): [(el: T | null) => void, boolean] {
  const [el, setEl] = useState<T | null>(null);
  const supported = typeof IntersectionObserver !== 'undefined';
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!el || !supported) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last) setSeen(last.isIntersecting);
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, supported, rootMargin]);
  const ref = useCallback((node: T | null) => setEl(node), []);
  return [ref, supported ? seen : true];
}
