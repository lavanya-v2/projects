import type jsPDF from 'jspdf';
import v2LogoSvg from '../../../../assets/v2-logo.svg?raw';

// Page chrome (header band + footer band) stamped onto every page of the
// exported delivery presentation PDF.
//
// Why this lives outside the PDF *document* component: the document is a single
// tall DOM node rasterised once by html2canvas and then sliced into pages, so
// anything drawn inside it can only ever appear once, wherever the slicer
// happens to put it. Header/footer have to be drawn per page, which means
// drawing them with jsPDF's own vector primitives after the slices are placed.

export interface PdfChromeMeta {
  /** Report title, e.g. "MAV — Sprint 5 Delivery Review". */
  title?: string;
  /** Account name, when the report has one. */
  accountName?: string;
  /** Project names in scope, already filtered to the visible set. */
  projectNames?: string[];
  /** Human-readable reporting period, e.g. "01 Aug 2026 - 15 Aug 2026". */
  period?: string;
  /** Export date, pre-formatted by the caller. */
  generatedOn?: string;
}

// Layout constants, millimetres. usePdfExport derives its page margins from
// these so slice content can never overlap the chrome.
export const CHROME = {
  // Matches the PDF document's own px:3 (24px @ 794px ≈ 210mm) inner padding,
  // so the chrome's rules line up with the content edges beneath them.
  sideMarginMm: 6.5,
  headerHeightMm: 14,
  footerHeightMm: 12,
  logoHeightMm: 6,
};

const LOGO_ASPECT = 287 / 64; // intrinsic size of v2-logo.svg
const RULE_COLOR: [number, number, number] = [0xd9, 0xe1, 0xec];
const TEXT_COLOR: [number, number, number] = [0x6b, 0x7a, 0x8f];
const TITLE_COLOR: [number, number, number] = [0x1a, 0x23, 0x32];

// Rasterise the inlined SVG once per export. jsPDF cannot place vector SVG, and
// an <img> pointed at a bundled URL would be an async network hop that can fail
// silently; inlining as a data URI keeps it self-contained. Drawn at 4x the
// printed size so it stays crisp at 300dpi-ish output.
async function rasterizeLogo(): Promise<{ dataUrl: string; aspect: number } | null> {
  try {
    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(v2LogoSvg)}`;
    const img = new Image();
    img.src = svgUrl;
    await img.decode();
    const w = img.naturalWidth || 287;
    const h = img.naturalHeight || 64;
    const scale = 4;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/png'), aspect: w / h };
  } catch {
    // A missing logo must never fail the whole export.
    return null;
  }
}

export async function loadLogo() {
  return rasterizeLogo();
}

// Truncate to fit a millimetre width, appending an ellipsis. jsPDF measures in
// the current font/size, so callers must set those before calling.
function fit(pdf: jsPDF, text: string, maxMm: number): string {
  if (!text) return '';
  if (pdf.getTextWidth(text) <= maxMm) return text;
  let out = text;
  while (out.length > 1 && pdf.getTextWidth(out + '…') > maxMm) out = out.slice(0, -1);
  return out + '…';
}

/**
 * Stamps the header and footer onto every page currently in the document.
 * Call after all page content has been added, so the page count is final.
 */
export function stampPageChrome(
  pdf: jsPDF,
  meta: PdfChromeMeta,
  logo: { dataUrl: string; aspect: number } | null
) {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const m = CHROME.sideMarginMm;
  const pageCount = pdf.getNumberOfPages();

  const projects = (meta.projectNames || []).filter(Boolean);
  const projectLine = projects.length === 0
    ? ''
    : projects.length <= 3
      ? projects.join(', ')
      : `${projects.slice(0, 3).join(', ')} +${projects.length - 3} more`;

  const headerRight1 = meta.title || '';
  const headerRight2 = [meta.accountName, projectLine, meta.period].filter(Boolean).join('  ·  ');

  const logoW = CHROME.logoHeightMm * (logo?.aspect ?? LOGO_ASPECT);
  const textLeftBound = m + logoW + 6;

  for (let p = 1; p <= pageCount; p++) {
    pdf.setPage(p);

    // ---- Header ----
    if (logo) {
      pdf.addImage(logo.dataUrl, 'PNG', m, 3.5, logoW, CHROME.logoHeightMm);
    } else {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.setTextColor(...TITLE_COLOR);
      pdf.text('V2Solutions', m, 8.5);
    }

    const maxRightMm = pageW - m - textLeftBound;
    if (headerRight1) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.setTextColor(...TITLE_COLOR);
      pdf.text(fit(pdf, headerRight1, maxRightMm), pageW - m, 6.5, { align: 'right' });
    }
    if (headerRight2) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);
      pdf.setTextColor(...TEXT_COLOR);
      pdf.text(fit(pdf, headerRight2, maxRightMm), pageW - m, 10.5, { align: 'right' });
    }

    pdf.setDrawColor(...RULE_COLOR);
    pdf.setLineWidth(0.3);
    pdf.line(m, CHROME.headerHeightMm - 1.5, pageW - m, CHROME.headerHeightMm - 1.5);

    // ---- Footer ----
    const footerRuleY = pageH - CHROME.footerHeightMm + 3;
    pdf.line(m, footerRuleY, pageW - m, footerRuleY);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(...TEXT_COLOR);
    const generated = meta.generatedOn ? `  ·  ${meta.generatedOn}` : '';
    pdf.text(`Generated by V2Solutions Lens application${generated}`, m, footerRuleY + 4);
    pdf.text(`Page ${p} of ${pageCount}`, pageW - m, footerRuleY + 4, { align: 'right' });
  }
}
