import { useEffect, useState, useCallback } from 'react';

export function useSlideNavigation(totalSlides: number) {
  const [activeSlide, setActiveSlide] = useState(0);

  // If total slides drops (e.g. filter removed a drilldown), clamp active slide.
  useEffect(() => {
    setActiveSlide(prev => Math.min(prev, Math.max(totalSlides - 1, 0)));
  }, [totalSlides]);

  const goNext = useCallback(
    () => setActiveSlide(p => Math.min(p + 1, totalSlides - 1)),
    [totalSlides],
  );
  const goPrev = useCallback(() => setActiveSlide(p => Math.max(p - 1, 0)), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goNext();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goPrev();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev]);

  return { activeSlide, setActiveSlide, goNext, goPrev };
}
