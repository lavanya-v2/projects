import {
  Box, Typography, Button, CircularProgress, Paper,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  IconButton, Tooltip,
} from '@mui/material';
import { Add, Edit, Delete } from '@mui/icons-material';
import { brandColors } from '../../../../theme/tokens';
import { tdSx, primaryBtnSx, tableWrapperSx } from '../styles';
import type { Account } from '../types';

const { navy } = brandColors;

interface AccountsListViewProps {
  accounts: Account[];
  loading: boolean;
  onCreate: () => void;
  onEdit: (acc: Account) => void;
  onDelete: (acc: Account) => void;
  onSelect: (acc: Account) => void;
}

/** Top-level accounts table. */
export const AccountsListView = ({
  accounts,
  loading,
  onCreate,
  onEdit,
  onDelete,
  onSelect,
}: AccountsListViewProps) => (
  <Box>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
      <Typography sx={{ fontFamily: 'Poppins, sans-serif', fontSize: 15, fontWeight: 700, color: navy }}>
        Accounts
      </Typography>
      <Button variant="contained" startIcon={<Add />} onClick={onCreate} sx={primaryBtnSx}>
        Add Account
      </Button>
    </Box>
    {loading ? (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress size={28} sx={{ color: navy }} />
      </Box>
    ) : (
      <Box sx={tableWrapperSx}>
        <TableContainer component={Paper} elevation={0}>
          <Table size="small">
            <TableHead sx={{ bgcolor: navy }}>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Code</TableCell>
                <TableCell>Projects</TableCell>
                <TableCell>Members</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {accounts.map(acc => (
                <TableRow
                  key={acc.id}
                  hover
                  sx={{
                    cursor: 'pointer',
                    '&:hover': { bgcolor: '#f8fafc' },
                    '&:last-child td': { borderBottom: 'none' },
                  }}
                  onClick={() => onSelect(acc)}
                >
                  <TableCell sx={tdSx}>
                    <Typography sx={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: navy }}>
                      {acc.name}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ ...tdSx, fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>
                    {acc.code}
                  </TableCell>
                  <TableCell sx={tdSx}>{acc.projectCounts}</TableCell>
                  <TableCell sx={tdSx}>{acc.memberCounts}</TableCell>
                  <TableCell align="right" sx={tdSx} onClick={e => e.stopPropagation()}>
                    <Tooltip title="Edit">
                      <IconButton
                        size="small"
                        onClick={() => onEdit(acc)}
                        sx={{ color: navy, '&:hover': { bgcolor: 'rgba(0,46,91,0.08)' } }}
                      >
                        <Edit fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        onClick={() => onDelete(acc)}
                        sx={{ color: '#ef4444', '&:hover': { bgcolor: 'rgba(239,68,68,0.08)' } }}
                      >
                        <Delete fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {accounts.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    align="center"
                    sx={{ py: 4, fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9ca3af' }}
                  >
                    No accounts found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    )}
  </Box>
);
