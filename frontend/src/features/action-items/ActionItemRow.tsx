import { TableRow, TableCell, Typography, Chip, IconButton, Tooltip, type ChipProps } from "@mui/material";
import dayjs from "dayjs";
import VisibilityIcon from '@mui/icons-material/Visibility';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { CATEGORY_COLORS, STATUS_COLORS } from "../../theme/tokens";
import { type ActionItemType, ALLOWED_TRANSITIONS } from "./types";

interface Props {
  item: ActionItemType;
  tooltipTitle: string;
  tab: string;
  userRole: string;
  handleClick: (item: ActionItemType) => void;  //handleAcctOpenDetail
  relatedName?: string;
  handleTransitionClick?: (item: ActionItemType) => void;
}

const ActionItemRow: React.FC<Props> = ({ item, tooltipTitle, relatedName, tab, userRole, handleClick, handleTransitionClick }) => {

  return (
    <TableRow key={item.id} >
      <TableCell sx={{ maxWidth: { xs: 140, sm: 200, md: 280 } }}>
        <Typography variant="body2" noWrap title={item.title}>{item.title}</Typography>
      </TableCell>

      {(tab === 'program-items' || tab === 'project-items') && (
        <TableCell sx={{ maxWidth: { xs: 140, sm: 200, md: 280 } }}>
          <Typography variant="body2">
            {relatedName}
          </Typography>
        </TableCell>
      )}

      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
        <Chip label={item.category} size="small"
          sx={{ bgcolor: CATEGORY_COLORS[item.category] ?? '#455a64', color: '#fff', fontSize: 11 }} />
      </TableCell>

      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
        <Typography variant="body2">{item.owner}</Typography>
      </TableCell>

      {(tab === 'project-items' || tab === 'program-items') && (
        <TableCell sx={{ display: { xs: "none", md: "table-cell" }, }} >
          <Typography variant="body2" color="text.secondary">
            {item.createdBy
              ? `${item.createdBy.firstName ?? ""} ${item.createdBy.lastName ?? ""}`.trim()
              : "-"}
          </Typography>
        </TableCell>
      )}

      <TableCell>
        <Chip
          label={item.status}
          size="small"
          color={STATUS_COLORS[item.status] as ChipProps["color"]}
        />
      </TableCell>

      <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
        <Typography variant="body2">
          {item.dueDate ? dayjs(item.dueDate).format('MMM D, YYYY') : '—'}
        </Typography>
      </TableCell>

      <TableCell align="center">
        <Tooltip title={tooltipTitle}>
          <IconButton size="small" onClick={() => handleClick(item)}>
            <VisibilityIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        {userRole !== 'lead' && ALLOWED_TRANSITIONS[item.status]?.length > 1 && tab === 'account-items' && (
          <Tooltip title="Transition Status">
            <IconButton size="small" color="primary" onClick={() => handleTransitionClick && handleTransitionClick(item)}>
              <ArrowForwardIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </TableCell>
    </TableRow>
  )
};

export default ActionItemRow;