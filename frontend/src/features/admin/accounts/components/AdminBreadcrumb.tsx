import { Box, Breadcrumbs, IconButton, Typography } from '@mui/material';
import { ArrowBack, NavigateNext } from '@mui/icons-material';
import type { Account } from '../types';

export type AdminView = 'accounts' | 'account' | 'project';

interface AdminBreadcrumbProps {
  view: AdminView;
  account: Account | null;
  project: any | null;
  onNavigate: (view: AdminView) => void;
}

/** Back button + breadcrumb trail for the accounts / account / project drill-down. */
export const AdminBreadcrumb = ({ view, account, project, onNavigate }: AdminBreadcrumbProps) => {
  if (view === 'accounts') return null;

  const handleBack = () => onNavigate(view === 'project' ? 'account' : 'accounts');

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
      <IconButton size="small" onClick={handleBack}>
        <ArrowBack />
      </IconButton>
      <Breadcrumbs separator={<NavigateNext fontSize="small" />}>
        <Typography
          sx={{ cursor: 'pointer', color: 'primary.main' }}
          onClick={() => onNavigate('accounts')}
        >
          Accounts
        </Typography>
        {account && (
          view === 'project'
            ? (
              <Typography
                sx={{ cursor: 'pointer', color: 'primary.main' }}
                onClick={() => onNavigate('account')}
              >
                {account.name}
              </Typography>
            )
            : <Typography color="text.primary">{account.name}</Typography>
        )}
        {view === 'project' && project && (
          <Typography color="text.primary">{project.name}</Typography>
        )}
      </Breadcrumbs>
    </Box>
  );
};
