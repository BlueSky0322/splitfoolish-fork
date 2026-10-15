import { useEffect, useRef, useState } from 'react';

/**
 * Phones: whether the balance and its buttons (heroRef) have scrolled out of sight
 * under the top bar (barRef), so the bar can show them instead. Checked on every
 * scroll, once a frame: they count as gone once their bottom edge has passed under the
 * bar, however slowly the page moved there.
 */
export function useHeroHidden(enabled: boolean) {
  const heroRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [heroHidden, setHeroHidden] = useState(false);
  useEffect(() => {
    const el = heroRef.current;
    if (!enabled || el == null) return;
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const barBottom = barRef.current?.getBoundingClientRect().bottom ?? 0;
        setHeroHidden(el.getBoundingClientRect().bottom <= barBottom);
      });
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [enabled]);
  return { heroRef, barRef, heroHidden };
}
