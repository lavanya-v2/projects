import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import dayjs from 'dayjs';
import {
  Box, Typography, Button, IconButton, CircularProgress, Tooltip, Popover,
  FormControlLabel, Checkbox, Divider, TextField, Badge, Snackbar, Alert,
} from '@mui/material';
import {
  ArrowBack, Edit, PictureAsPdf, ChatBubbleOutline, ArrowBackIos, ArrowForwardIos,
  Tune as TuneIcon, VisibilityOutlined, EditNote as EditNoteIcon, Link as LinkIcon,
  Fullscreen as FullscreenIcon, FullscreenExit as FullscreenExitIcon,
} from '@mui/icons-material';
import { portfolioPresentationViewUrl } from '../../../routes/paths';
import PortfolioMOMDialog from './PortfolioMOMDialog';
import { ManageTrendSprintsDialog } from './ManageTrendSprintsDialog';
import { useUpdatePortfolioPresentation } from './hooks';
import { buildSlides, healthColor, type ProjectFilterState, type VelocityViewMode } from './presentation/slides';
import { type Scope, DEFAULT_SCOPE, ScopeToggle } from './presentation/scope';
import { useSlideNavigation } from './presentation/hooks/useSlideNavigation';
import { usePdfExport } from './presentation/hooks/usePdfExport';
import { SlideScaler } from './presentation/SlideScaler';
import { FullscreenContainerContext } from './presentation/FullscreenContainerContext';
import { PortfolioPresentationPdfDocument } from './presentation/PortfolioPresentationPdfDocument';
import { Chip } from '@mui/material';
import type { PortfolioPerProjectDrilldown, PortfolioPresentation } from './types';

interface Props {
  report: PortfolioPresentation;
  onBack: () => void;
  onEdit: () => void;
  // 'review'  : internal manager view — all controls (Edit, MOM, Manage Trends, Download PDF).
  // 'present' : clean customer-facing view — hides Edit/MOM/Manage Trends/Download PDF.
  //             MOM upload happens after the meeting via the 'review' entry point.
  mode?: 'review' | 'present';
}

export function PortfolioPresentation({ report, onBack, onEdit, mode = 'review' }: Props) {
  const isPresentMode = mode === 'present';
  const [liveReport, setLiveReport] = useState<PortfolioPresentation>(report);
  const [momOpen, setMomOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [visibilityAnchor, setVisibilityAnchor] = useState<HTMLElement | null>(null);
  const visibilityBtnRef = useRef<HTMLButtonElement | null>(null);

  // Fullscreen — lets the presenter hide the browser chrome (tabs/bookmarks)
  // and present the deck edge-to-edge. Requested on the fixed overlay root so
  // the whole presentation fills the screen; the SlideScaler then re-measures
  // the larger stage and scales content up further.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      rootRef.current?.requestFullscreen().catch(() => {});
    }
  }, []);

  // Presenter notes — free text the presenter types live per slide, keyed by
  // slide id. Pure persistence (no AI); folded into MOM at generation time.
  const updateMut = useUpdatePortfolioPresentation();
  const [presenterNotes, setPresenterNotes] = useState<Record<string, string>>(
    () => liveReport.presenterNotes || {}
  );
  const [noteAnchor, setNoteAnchor] = useState<HTMLElement | null>(null);
  const noteBtnRef = useRef<HTMLButtonElement | null>(null);
  const [noteToast, setNoteToast] = useState<null | { ok: boolean; msg: string }>(null);
  const isLocked = !!liveReport.lockedAt;
  const persistNotes = useCallback((next: Record<string, string>) => {
    setLiveReport((prev) => ({ ...prev, presenterNotes: next }));
    if (!liveReport.id) return;
    updateMut.mutate(
      { id: liveReport.id, data: { presenterNotes: next } },
      {
        onSuccess: () => setNoteToast({ ok: true, msg: 'Notes saved' }),
        onError: (e: Error) => setNoteToast({ 
          ok: false, 
          msg: (e as Error & { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to save notes' 
        }),
      }
    );
  }, [liveReport.id, updateMut]);

  const drilldown: PortfolioPerProjectDrilldown[] = liveReport.perProjectDrilldown || [];
  const initialHidden = useMemo(
    () => new Set<number>(drilldown.filter((d) => d.isVisible === false).map((d) => d.projectId as number)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [hidden, setHidden] = useState<Set<number>>(initialHidden);

  // Per-slide metric scope (Whole Team default). Keyed by slide id so each slide
  // (Overview, Trends, and each project drilldown) toggles independently. The
  // PDF export reads the same map so the saved document is WYSIWYG.
  const [slideScopes, setSlideScopes] = useState<Record<string, Scope>>({});
  const scopeFor = useCallback((id: string): Scope => slideScopes[id] ?? DEFAULT_SCOPE, [slideScopes]);
  const setScopeFor = useCallback((id: string, s: Scope) => {
    setSlideScopes(prev => ({ ...prev, [id]: s }));
  }, []);

  // Raw SP vs sprint-length-normalized view for the Velocity Trend chart only.
  // Additive to the scope toggle above — defaults to 'normalized' so a shorter/
  // longer sprint doesn't read as a productivity swing unless the presenter
  // explicitly switches to the raw view. The PDF export reads the same state
  // so the saved document is WYSIWYG.
  const [velocityViewMode, setVelocityViewMode] = useState<VelocityViewMode>('normalized');

  const toggleProject = useCallback((projectId: number | null) => {
     if (projectId === null) return;
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  const visibleIds = useMemo(
    () => drilldown.map((d) => d.projectId as number).filter((pid: number) => !hidden.has(pid)),
    [drilldown, hidden]
  );

  const visibleProjects = useMemo(
    () => drilldown
      .filter((d) => d.projectId !== null && !hidden.has(d.projectId))
      .map((d) => ({ projectId: d.projectId as number, projectName: d.projectName as string })),
    [drilldown, hidden]
  );

  const filter = useMemo<ProjectFilterState>(
    () => ({
      hidden,
      toggle: toggleProject,
      visibleIds,
    }),
    [hidden, toggleProject, visibleIds]
  );

  const slides = useMemo(() => buildSlides(liveReport, filter), [liveReport, filter]);
  const { activeSlide, setActiveSlide, goNext, goPrev } = useSlideNavigation(slides.length);
  const pdf = usePdfExport();

  const handleDownloadPdf = () => {
    const filename = `${(liveReport.title || 'Delivery').replace(/\s+/g, '_')}_${liveReport.meetingDate || ''}.pdf`;
    // Project info for the per-page header — only the projects actually
    // included in this export, so the header can't advertise a hidden project.
    const projectNames = (liveReport.perProjectDrilldown || [])
      .filter((d: any) => visibleIds.includes(d.projectId))
      .map((d: any) => d.projectName)
      .filter(Boolean);
    pdf.download(filename, {
      title: liveReport.title || 'Delivery Presentation',
      accountName: liveReport.account?.name,
      projectNames,
      period: liveReport.startDate && liveReport.endDate
        ? `${dayjs(liveReport.startDate).format('DD MMM YYYY')} - ${dayjs(liveReport.endDate).format('DD MMM YYYY')}`
        : undefined,
      generatedOn: dayjs().format('DD MMM YYYY'),
    });
  };

  const slide = slides[activeSlide] ?? slides[0];

  const handleCopyShareLink = useCallback(async () => {
    if (!liveReport.id) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${portfolioPresentationViewUrl("presentation",liveReport.id)}`);
      setNoteToast({ ok: true, msg: 'Share link copied' });
    } catch {
      setNoteToast({ ok: false, msg: 'Could not copy link' });
    }
  }, [liveReport.id]);

  return (
    <FullscreenContainerContext.Provider value={rootEl}>
      <Box
        ref={(el: HTMLDivElement | null) => { rootRef.current = el; setRootEl(el); }}
        sx={{ position: 'fixed', inset: 0, zIndex: 1400, display: 'flex', flexDirection: 'column', bgcolor: '#1a2332' }}
      >
        {/* Header */}
        <Box sx={{ bgcolor: '#0d1b2e', color: 'white', px: { xs: 2, md: 3 }, py: 1.25, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <IconButton onClick={onBack} sx={{ color: 'white' }}><ArrowBack /></IconButton>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography fontWeight={700} sx={{ fontSize: { xs: 14, md: 16 } }} noWrap>{liveReport.title}</Typography>
            <Typography variant="caption" sx={{ opacity: 0.7 }} noWrap>
              {liveReport.account?.name ? `${liveReport.account.name} · ` : ''}{dayjs(liveReport.startDate).format('DD MMM YYYY')} → {dayjs(liveReport.endDate).format('DD MMM YYYY')}
            </Typography>
          </Box>
          <Chip label={liveReport.health} color={healthColor(liveReport.health)} size="small" sx={{ fontWeight: 700 }} />
          <Tooltip title={`Project visibility (${visibleIds.length}/${drilldown.length} shown)`}>
            <IconButton
              ref={visibilityBtnRef}
              onClick={() => setVisibilityAnchor(visibilityBtnRef.current)}
              sx={{ color: 'white' }}
            >
              <VisibilityOutlined />
            </IconButton>
          </Tooltip>
          {!!liveReport.id && (
            <Tooltip title="Copy share link">
              <IconButton onClick={handleCopyShareLink} sx={{ color: 'white' }}>
                <LinkIcon />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={isFullscreen ? 'Exit full screen' : 'Present full screen'}>
            <IconButton onClick={toggleFullscreen} sx={{ color: 'white' }}>
              {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
            </IconButton>
          </Tooltip>
          {!isPresentMode && (
            <>
              <Tooltip title="Manage trend sprints (internal)">
                <span>
                  <IconButton
                    onClick={() => setManageOpen(true)}
                    disabled={!!liveReport.lockedAt}
                    sx={{ color: 'white' }}
                  >
                    <TuneIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Edit presentation">
                <span><IconButton onClick={onEdit} disabled={!!liveReport.lockedAt} sx={{ color: 'white' }}><Edit /></IconButton></span>
              </Tooltip>
              <Tooltip title="Open MOM">
                <IconButton onClick={() => setMomOpen(true)} sx={{ color: 'white' }}>
                  <ChatBubbleOutline />
                </IconButton>
              </Tooltip>
              <Button
                variant="contained"
                color="primary"
                size="small"
                startIcon={pdf.generating ? <CircularProgress size={14} color="inherit" /> : <PictureAsPdf />}
                disabled={pdf.generating}
                onClick={handleDownloadPdf}
              >
                {pdf.generating ? 'Generating…' : 'Download PDF'}
              </Button>
            </>
          )}
        </Box>

        {/* Slide stage */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'white' }}>
          <Box sx={{ bgcolor: slide.color, color: 'white', px: { xs: 2, md: 4 }, py: 1.25, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {slide.icon}
            <Typography fontWeight={700} sx={{ fontSize: { xs: 16, md: 20 } }}>{slide.name}</Typography>
            {slide.scoped && (
              // Toggle lives in the fixed header bar so it stays reachable while
              // scrolling through the slide's charts/tables. The white wrapper
              // keeps the buttons legible on the coloured bar.
              <Box sx={{ ml: 'auto', bgcolor: 'white', borderRadius: 1, px: 0.5, py: 0.25 }}>
                <ScopeToggle scope={scopeFor(slide.id)} onChange={(s) => setScopeFor(slide.id, s)} />
              </Box>
            )}
            <Tooltip title={isLocked ? 'Notes (locked — MOM accepted)' : 'Discussion notes for this slide'}>
              <IconButton
                ref={noteBtnRef}
                onClick={() => setNoteAnchor(noteBtnRef.current)}
                size="small"
                sx={{ ml: slide.scoped ? 1.5 : 'auto', color: 'white' }}
              >
                <Badge color="warning" variant="dot" invisible={!(presenterNotes[slide.id] || '').trim()}>
                  <EditNoteIcon fontSize="small" />
                </Badge>
              </IconButton>
            </Tooltip>
            <Box sx={{ ml: 1, px: 1.25, py: 0.2, borderRadius: 0.75, bgcolor: 'rgba(255,255,255,0.2)', fontWeight: 700, fontSize: 11, letterSpacing: 0.5 }}>
              {activeSlide + 1} / {slides.length}
            </Box>
          </Box>
          <SlideScaler key={activeSlide}>
            {slide.render(liveReport, filter, {
              scope: scopeFor(slide.id), onScopeChange: (s) => setScopeFor(slide.id, s),
              velocityViewMode, onVelocityViewModeChange: setVelocityViewMode,
            })}
          </SlideScaler>
        </Box>

        {/* Footer */}
        <Box sx={{ bgcolor: '#0d1b2e', color: 'white', px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'space-between' }}>
          <IconButton onClick={goPrev} disabled={activeSlide === 0} sx={{ color: 'white', '&.Mui-disabled': { color: 'rgba(255,255,255,0.3)' } }}>
            <ArrowBackIos fontSize="small" />
          </IconButton>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: 'center' }}>
            {slides.map((s, i) => (
              <Box key={s.id}
                onClick={() => setActiveSlide(i)}
                sx={{
                  width: 10, height: 10, borderRadius: '50%', cursor: 'pointer',
                  bgcolor: i === activeSlide ? s.color : 'rgba(255,255,255,0.35)',
                  border: i === activeSlide ? '2px solid white' : 'none',
                  transition: 'background-color 120ms',
                }}
              />
            ))}
          </Box>
          <IconButton onClick={goNext} disabled={activeSlide >= slides.length - 1} sx={{ color: 'white', '&.Mui-disabled': { color: 'rgba(255,255,255,0.3)' } }}>
            <ArrowForwardIos fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      {momOpen && (
        <PortfolioMOMDialog
          open={momOpen}
          report={liveReport}
          onClose={() => setMomOpen(false)}
          onAccepted={(updated) => { setLiveReport(updated); setMomOpen(false); }}
        />
      )}

      {manageOpen && (
        <ManageTrendSprintsDialog
          open={manageOpen}
          presentationId={liveReport.id}
          visibleProjects={visibleProjects}
          trendData={liveReport.trendData || {}}
          onClose={() => setManageOpen(false)}
          onRefreshed={(updated) => setLiveReport(updated)}
        />
      )}

      <Popover
        open={Boolean(visibilityAnchor)}
        anchorEl={visibilityAnchor}
        onClose={() => setVisibilityAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        container={rootEl ?? undefined}
        sx={{ zIndex: 1600 }}
        slotProps={{ paper: { sx: { p: 1.5, minWidth: 240, maxWidth: 320 } } }}
      >
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.25 }}>Project visibility</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Toggle per-project drill-down slides and PDF inclusion.
        </Typography>
        <Divider sx={{ mb: 1 }} />
        <Box sx={{ display: 'flex', flexDirection: 'column', maxHeight: 320, overflowY: 'auto' }}>
          {drilldown.map((d) => (
            <FormControlLabel
              key={d.projectId ?? d.projectName}
              control={
                <Checkbox
                  size="small"
                  checked={d.projectId == null || !hidden.has(d.projectId)}
                  onChange={() => toggleProject(d.projectId)}
                />
              }
              label={<Typography variant="body2">{d.projectName}</Typography>}
              sx={{ mr: 0, py: 0.25 }}
            />
          ))}
          {drilldown.length === 0 && (
            <Typography variant="caption" color="text.secondary">No projects to toggle.</Typography>
          )}
        </Box>
      </Popover>

      <Popover
        open={Boolean(noteAnchor)}
        anchorEl={noteAnchor}
        onClose={() => { setNoteAnchor(null); persistNotes(presenterNotes); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        container={rootEl ?? undefined}
        sx={{ zIndex: 1600 }}
        slotProps={{ paper: { sx: { p: 1.5, width: 360 } } }}
      >
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.25 }}>
          Notes — {slide.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          {isLocked
            ? 'This presentation is locked (MOM accepted). Notes are read-only.'
            : 'Captured for the record and folded into the MOM. Not sent to AI for analysis.'}
        </Typography>
        <TextField
          multiline
          minRows={4}
          maxRows={12}
          fullWidth
          autoFocus={!isLocked}
          placeholder="Type discussion points, feedback or conclusions for this slide…"
          value={presenterNotes[slide.id] ?? ''}
          onChange={(e) => setPresenterNotes(prev => ({ ...prev, [slide.id]: e.target.value }))}
          slotProps={{ input: { readOnly: isLocked } }}
          size="small"
        />
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1, gap: 1 }}>
          <Button size="small" onClick={() => setNoteAnchor(null)}>Close</Button>
          <Button
            size="small"
            variant="contained"
            disabled={isLocked || updateMut.isPending}
            onClick={() => { persistNotes(presenterNotes); setNoteAnchor(null); }}
          >
            {updateMut.isPending ? 'Saving…' : 'Save'}
          </Button>
        </Box>

        {/* Consolidated view — every slide that has a note, so the presenter can
            review all notes across the deck from any slide. */}
        {(() => {
          const all = slides
            .map(s => ({ id: s.id, name: s.name, text: (presenterNotes[s.id] || '').trim() }))
            .filter(e => e.text);
          return (
            <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px dashed #cfd8dc' }}>
              <Typography variant="caption" fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: 0.4, color: '#37474f' }}>
                All notes in this presentation ({all.length})
              </Typography>
              {all.length === 0 ? (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  No notes yet. Notes you save here are stored with the presentation and appear in the MOM.
                </Typography>
              ) : (
                <Box sx={{ mt: 0.75, maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {all.map(e => (
                    <Box
                      key={e.id}
                      onClick={() => { const i = slides.findIndex(s => s.id === e.id); if (i >= 0) setActiveSlide(i); }}
                      sx={{ cursor: 'pointer', p: 0.75, borderRadius: 0.75, bgcolor: e.id === slide.id ? '#eef4fb' : '#f7f8fa', '&:hover': { bgcolor: '#eef4fb' } }}
                    >
                      <Typography variant="caption" fontWeight={700} sx={{ color: '#1565c0' }}>{e.name}</Typography>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 12.5 }}>{e.text}</Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          );
        })()}
      </Popover>

      <Snackbar
        open={!!noteToast}
        autoHideDuration={2500}
        onClose={() => setNoteToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ zIndex: 1700 }}
      >
        <Alert severity={noteToast?.ok ? 'success' : 'error'} variant="filled" onClose={() => setNoteToast(null)}>
          {noteToast?.msg}
        </Alert>
      </Snackbar>

      <PortfolioPresentationPdfDocument
        ref={pdf.targetRef}
        report={report}
        liveReport={liveReport}
        visibleProjectIds={visibleIds}
        slideScopes={slideScopes}
        velocityViewMode={velocityViewMode}
      />
    </FullscreenContainerContext.Provider>
  );
}
