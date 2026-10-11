import { useCallback, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { CHROME, loadLogo, stampPageChrome, type PdfChromeMeta } from '../pdfChrome';

// Page-break-aware PDF export.
//
// Why: html2canvas rasterises the whole document into one tall PNG, and our
// previous slicer just chopped that PNG at fixed page heights. When a slice
// boundary landed inside a paragraph or a table row, the row/text got cut in
// half across two pages. We now measure the positions of "atomic" blocks
// (<tr>, plus any element tagged data-pdf-block) and push page boundaries up
// to just before a block whenever a naive boundary would split one.
export function usePdfExport() {
  const targetRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);

  const download = useCallback(async (filename: string, chromeMeta: PdfChromeMeta = {}) => {
    if (!targetRef.current) return;
    setGenerating(true);
    try {
      const target = targetRef.current;
      // Rasterised up front so a slow/failed decode can't leave half a document.
      const logo = await loadLogo();

      // Capture atomic-block positions in CSS pixels relative to the target,
      // BEFORE rasterising (we need the live DOM for getBoundingClientRect).
      const containerRect = target.getBoundingClientRect();
      const atomicEls = Array.from(
        target.querySelectorAll<HTMLElement>('tr, [data-pdf-block]')
      );
      const atomicCssRanges = atomicEls.map(el => {
        const r = el.getBoundingClientRect();
        return {
          top: r.top - containerRect.top,
          bottom: r.bottom - containerRect.top,
        };
      });

      // Forced page breaks: elements tagged data-pdf-page-break-before="always"
      // are guaranteed to start at the top of a new PDF page. Captures the top
      // offset of each so we can snap nextBreak down to that position.
      const forceBreakEls = Array.from(
        target.querySelectorAll<HTMLElement>('[data-pdf-page-break-before="always"]')
      );
      const forceBreakCssTops = forceBreakEls.map(
        el => el.getBoundingClientRect().top - containerRect.top
      );

      const canvas = await html2canvas(target, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });

      // Map CSS pixel ranges to canvas pixel ranges (scale: 2).
      const cssToCanvas = canvas.width / target.offsetWidth;
      const atomicCanvasRanges = atomicCssRanges.map(r => ({
        top: r.top * cssToCanvas,
        bottom: r.bottom * cssToCanvas,
      }));
      const forceBreakCanvasTops = forceBreakCssTops.map(t => t * cssToCanvas);

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidthMm = pdf.internal.pageSize.getWidth();
      const pageHeightMm = pdf.internal.pageSize.getHeight();

      // Top/bottom page margins. Each slice is drawn at MARGIN_TOP_MM and is at
      // most usableHeightMm tall, so the bottom margin is naturally left blank.
      // Both are derived from the header/footer band heights (plus a little
      // breathing room) so content can never run underneath the page chrome.
      const MARGIN_TOP_MM = CHROME.headerHeightMm + 2;
      const MARGIN_BOTTOM_MM = CHROME.footerHeightMm + 2;
      const usableHeightMm = pageHeightMm - MARGIN_TOP_MM - MARGIN_BOTTOM_MM;

      // Canvas width corresponds to pageWidthMm in PDF coords.
      const canvasPxPerMm = canvas.width / pageWidthMm;
      // A page can only hold usableHeightMm of content (the rest is margin).
      const pageHeightCanvasPx = usableHeightMm * canvasPxPerMm;

      // Compute slice boundaries: walk from top to bottom, taking up to one
      // page-height at a time. If the natural boundary would split an atomic
      // block (its top < boundary < its bottom), snap the boundary up to the
      // top of that block so the block starts cleanly on the next page.
      const slices: Array<{ startPx: number; heightPx: number }> = [];
      let cursor = 0;
      const eps = 0.5; // sub-pixel slack
      while (cursor < canvas.height - eps) {
        let nextBreak = Math.min(cursor + pageHeightCanvasPx, canvas.height);

        // Forced break: if any data-pdf-page-break-before="always" element
        // sits inside the current page window, snap nextBreak down to the
        // earliest such top. This guarantees a fresh page starts there even
        // if the current page still has room.
        const forced = forceBreakCanvasTops
          .filter(t => t > cursor + eps && t <= nextBreak + eps);
        if (forced.length > 0) {
          nextBreak = Math.min(...forced);
        } else {
          // No forced break in this window — fall back to the atomic-block
          // guard so we don't split a block across pages. Blocks taller than a
          // usable page are excluded: they can never fit on any page, so snapping
          // to their top would only leave a big blank and then split them anyway.
          // Letting the boundary fall inside such a block lets its finer inner
          // blocks (table rows / developer rows) provide clean split points.
          const conflicting = atomicCanvasRanges
            .filter(r => r.top > cursor + eps && r.top < nextBreak - eps && r.bottom > nextBreak
              && (r.bottom - r.top) <= pageHeightCanvasPx)
            .map(r => r.top);
          if (conflicting.length > 0) {
            const snap = Math.min(...conflicting);
            // Guard: if snapping would create a zero/negative slice (i.e. the
            // very next block is already taller than a page), fall back to the
            // raw break so we still make forward progress.
            if (snap > cursor + eps) nextBreak = snap;
          }
        }
        const heightPx = nextBreak - cursor;
        slices.push({ startPx: cursor, heightPx });
        cursor = nextBreak;
      }

      // Render each slice into its own canvas and add to the PDF.
      for (let i = 0; i < slices.length; i++) {
        const { startPx, heightPx } = slices[i];
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = Math.max(1, Math.round(heightPx));
        const ctx = sliceCanvas.getContext('2d');
        if (!ctx) continue;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        ctx.drawImage(canvas, 0, -startPx);
        const imgData = sliceCanvas.toDataURL('image/png');
        const sliceHeightMm = (sliceCanvas.height / canvasPxPerMm);
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, MARGIN_TOP_MM, pageWidthMm, sliceHeightMm);
      }

      // Header/footer last: the page count is only final once every slice has
      // been placed.
      stampPageChrome(pdf, chromeMeta, logo);

      pdf.save(filename);
    } catch (e) {
      console.error('PDF generation failed:', e);
    } finally {
      setGenerating(false);
    }
  }, []);

  return { targetRef, generating, download };
}
