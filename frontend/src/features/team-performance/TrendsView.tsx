import { Box, Tab, Tabs } from '@mui/material';
import {
  TrendingUp,
  BugReport,
  // SecurityOutlined, // Hidden: Defect Leakage tab temporarily disabled
  Replay as ReplayIcon,
} from '@mui/icons-material';
import { useSearchParams } from 'react-router-dom';
import { ProductivityOverview } from './ProductivityOverview';
import { DefectDensityTrend } from './DefectDensityTrend';
import { DefectLeakageTrend } from './DefectLeakageTrend';
import { ReopenRatioTrend } from './ReopenRatioTrend';
import { useEffect } from 'react';

type TrendTab = 'productivity' | 'defect-density' | 'defect-leakage' | 'reopen-ratio';

interface Props {
  accountId: number | '';
}

export function TrendsView({ accountId }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as TrendTab) || 'productivity';

  useEffect(() => {
  if (!searchParams.get('tab')) {
    setSearchParams({ tab: 'productivity' }, { replace: true });
  }
  }, [searchParams, setSearchParams]);

  return (
    <Box data-testid="trends-view">
      <Tabs
        value={activeTab}
        onChange={(_, newValue) => setSearchParams({ tab: newValue })}
        variant="scrollable"
        scrollButtons="auto"
        data-testid="trends-tab-strip"
        sx={{
          px: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: '#fafbff',
          '& .MuiTab-root': {
            minHeight: 42,
            textTransform: 'none',
            fontWeight: 600,
            fontSize: 13,
            gap: 0.5,
          },
        }}
      >
        <Tab icon={<TrendingUp sx={{ fontSize: 18 }} />} iconPosition="start" label="Productivity" value="productivity" data-testid="trends-tab-productivity" />
        <Tab icon={<BugReport sx={{ fontSize: 18 }} />} iconPosition="start" label="Defect Density" value="defect-density" data-testid="trends-tab-density" />
        {/* Hidden: Defect Leakage tab temporarily disabled
        <Tab icon={<SecurityOutlined sx={{ fontSize: 18 }} />} iconPosition="start" label="Defect Leakage" value="defect-leakage" data-testid="trends-tab-leakage" />
        */}
        <Tab icon={<ReplayIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="Reopen Ratio" value="reopen-ratio" data-testid="trends-tab-reopen" />
      </Tabs>

      {activeTab === 'productivity' && <ProductivityOverview accountId={accountId} />}
      {activeTab === 'defect-density' && <DefectDensityTrend accountId={accountId} />}
      {activeTab === 'defect-leakage' && <DefectLeakageTrend accountId={accountId} />}
      {activeTab === 'reopen-ratio' && <ReopenRatioTrend accountId={accountId} />}
    </Box>
  );
}
