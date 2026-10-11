import { useState } from 'react';
import type { MouseEvent } from 'react';
import { Box, Button, IconButton, ListItemIcon, Menu, MenuItem, Tooltip } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import DescriptionIcon from '@mui/icons-material/Description';
import TableChartIcon from '@mui/icons-material/TableChart';
import { useDownloadTrendsReport } from './hooks';

interface Props {
  accountId: number;
  projectId?: number;
  label?: string;
  tooltip?: string;
}

/**
 * Download menu for Team Performance -> Trends (Productivity + Defect Density + Reopen
 * Ratio bundled together). Pass `projectId` for a single-project download, omit it to
 * download every project in the account. With `label` renders as a text button
 * (toolbar use); without it renders as a compact icon-only button (per-row use).
 */
export function TrendsDownloadButton({ accountId, projectId, label, tooltip }: Props) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const { mutate: download, isPending } = useDownloadTrendsReport();

  const handleOpen = (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setAnchorEl(e.currentTarget);
  };
  const handleClose = () => setAnchorEl(null);
  const handleDownload = (format: 'html' | 'xlsx') => {
    download({ accountId, projectId, format });
    handleClose();
  };

  const trigger = label ? (
    <Button
      variant="outlined"
      size="small"
      startIcon={<DownloadIcon />}
      onClick={handleOpen}
      disabled={isPending}
      data-testid="trends-download-all-button"
    >
      {label}
    </Button>
  ) : (
    <Tooltip title={tooltip ?? 'Download this project\'s trends'}>
      <span>
        <IconButton size="small" onClick={handleOpen} disabled={isPending} data-testid={`trends-download-project-${projectId}`}>
          <DownloadIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </span>
    </Tooltip>
  );

  return (
    <Box component="span" onClick={e => e.stopPropagation()}>
      {trigger}
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={handleClose}>
        <MenuItem onClick={() => handleDownload('html')}>
          <ListItemIcon>
            <DescriptionIcon fontSize="small" color="primary" />
          </ListItemIcon>
          Download HTML
        </MenuItem>
        <MenuItem onClick={() => handleDownload('xlsx')}>
          <ListItemIcon>
            <TableChartIcon fontSize="small" color="primary" />
          </ListItemIcon>
          Download Excel
        </MenuItem>
      </Menu>
    </Box>
  );
}
