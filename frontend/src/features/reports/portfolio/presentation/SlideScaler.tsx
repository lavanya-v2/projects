import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Box } from '@mui/material';

/**
 * Fit-to-width slide scaler — makes each presentation slide read like a real
 * PPT slide on a large display.
 *
 * The slide content is rendered at a fixed DESIGN_W so its (fixed-px) fonts and
 * cards keep a stable relationship, then the whole block is scaled up to fill
 * the available stage width via CSS `transform: scale()`. On a 2560px screen a
 * 1280px design scales ~2x, so type/cards grow proportionally and — crucially —
 * nothing ever scrolls horizontally (chart columns with fixed min-widths reflow
 * to 1280px, then scale visually).
 *
 * Vertical behaviour: when the scaled content is shorter than the stage it is
 * centred (no empty bottom); when a rare content-heavy slide is taller, it
 * top-aligns and the stage scrolls vertically.
 *
 * The scaler wraps whatever a slide renders, so slide layouts, charts and
 * tables are untouched. Popovers/tooltips are portaled to document.body and are
 * unaffected by the transform.
 */

// Tunable knobs — adjust if type feels too large/small after a visual check.
const DESIGN_W = 1280;
const MIN_SCALE = 0.6;
const MAX_SCALE = 2.2;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function SlideScaler({ children }: { children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [contentH, setContentH] = useState(0);
  const [availH, setAvailH] = useState(0);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const content = contentRef.current;
    if (!stage || !content) return;

    const recompute = () => {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      // scrollHeight/offsetHeight are layout dimensions — unaffected by the
      // transform on the content — so this is the true unscaled height.
      const natH = content.scrollHeight;
      setScale(clamp(w / DESIGN_W, MIN_SCALE, MAX_SCALE));
      setContentH(natH);
      setAvailH(h);
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(stage);
    ro.observe(content);
    document.addEventListener('fullscreenchange', recompute);
    return () => {
      ro.disconnect();
      document.removeEventListener('fullscreenchange', recompute);
    };
  }, []);

  const scaledH = contentH * scale;
  const fits = scaledH <= availH;

  return (
    <Box
      ref={stageRef}
      sx={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        scrollbarGutter: 'stable',
        px: { xs: 2, md: 4 },
        py: 3,
        bgcolor: '#f8fafd',
        display: 'flex',
        justifyContent: 'center',
        alignItems: fits ? 'center' : 'flex-start',
        animation: 'fadeSlideIn 0.22s ease-out',
        '@keyframes fadeSlideIn': {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
      }}
    >
      {/* Sizer reserves the scaled footprint so scrolling/centering are correct
          (transform does not change the layout box size). */}
      <Box
        sx={{
          position: 'relative',
          width: DESIGN_W * scale,
          height: scaledH || undefined,
          flexShrink: 0,
        }}
      >
        <Box
          ref={contentRef}
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: DESIGN_W,
            transformOrigin: 'top left',
            transform: `scale(${scale})`,
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
