import { Box, CircularProgress } from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import { PATHS, portfolioPresentationEditUrl } from '../../../routes/paths';
import { NotFound } from '../../../shared/components/NotFound';
import { usePortfolioPresentation } from './hooks';
import { PortfolioPresentation } from './PortfolioPresentation';

/**
 * Deep-link viewer for a single delivery presentation (/presentations/delivery/:id).
 *
 * The route only requires authentication — role/project authorization is enforced
 * by the API (requirePortfolioPresentationAccess), so any 403/404 becomes a 404
 * page here rather than a silent redirect. Opens in clean presentation mode.
 */
export function PortfolioPresentationViewPage() {
  const { mode, id } = useParams<{ mode: string, id: string }>();
  const navigate = useNavigate();
  const numericId = id ? Number(id) : NaN;
  const { data, isLoading,isError } = usePortfolioPresentation(
    Number.isFinite(numericId) ? numericId : null
  );

  const isMode = mode === 'presentation' ? "present": "review"

  if (!Number.isFinite(numericId) || isError || !mode) {
    return <NotFound />;
  }

  if (isLoading || !data) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <PortfolioPresentation
      report={data}
      mode={isMode}
      onBack={() => navigate(PATHS.PORTFOLIO_PRESENTATION)}
      onEdit={() => { navigate(portfolioPresentationEditUrl(numericId)) }}
    />
  );
}
