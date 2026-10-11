import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
} from "@mui/material";
import ActionItemRow from "./ActionItemRow";
import type { ActionItemTab, ActionItemType, SortConfig } from "./types";

interface ActionItemTableProps {
  items: ActionItemType[];
  totalItems: number;
  page: number;
  limit: number;
  tab: ActionItemTab;
  relatedColumnLabel: string;
  sortConfig?: SortConfig;
  onSortRequest: (column: "status" | "category" | "dueDate") => void;
  onPageChange: (page: number) => void;
  userId?: number;
  userRole: string;
  isSuperuser: boolean;
  isAdmin: boolean;
  isManager: boolean;
  isLead: boolean;
  onOpenDetail: (item: ActionItemType) => void;
  handleTransitionClick?: (item: ActionItemType) => void;
}

interface SortableHeaderProps {
  label: string;
  column: "status" | "category" | "dueDate";
  sortConfig?: SortConfig;
  onSortRequest: (column: "status" | "category" | "dueDate") => void;
}

const SortableHeader = ({
  label,
  column,
  sortConfig,
  onSortRequest,
}: SortableHeaderProps) => {
  const isActive = sortConfig?.column === column;

  return (
    <strong>
      {label}
      <TableSortLabel
        sx={{ fontSize: 10 }}
        active={isActive}
        direction={sortConfig?.direction === "DESC" ? "desc" : "asc"}
        onClick={() => onSortRequest(column)}
      />
    </strong>
  );
};

const ActionItemTable = ({
  items,
  totalItems,
  page,
  limit,
  tab,
  relatedColumnLabel,
  sortConfig,
  onSortRequest,
  onPageChange,
  userId,
  userRole,
  isSuperuser,
  isAdmin,
  isManager,
  isLead,
  onOpenDetail,
  handleTransitionClick,
}: ActionItemTableProps) => {
  return (
    <TableContainer sx={{ overflowX: "auto" }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            {/* Title */}
            <TableCell>Title</TableCell>

            {/* Project / Program */}
            {(tab === "project-items" || tab === "program-items") && (
              <TableCell>{relatedColumnLabel}</TableCell>
            )}

            {/* Category */}
            <TableCell
              sx={{
                display: {
                  xs: "none",
                  md: "table-cell",
                },
              }}
            >
              <SortableHeader
                label="Category"
                column="category"
                sortConfig={sortConfig}
                onSortRequest={onSortRequest}
              />
            </TableCell>

            {/* Owner */}
            <TableCell
              sx={{
                display: {
                  xs: "none",
                  md: "table-cell",
                },
              }}
            >
              Owner
            </TableCell>

            {/* Created By */}
            {(tab !== 'account-items') &&
              <TableCell
                sx={{
                  display: {
                    xs: "none",
                    md: "table-cell",
                  },
                }}
              >
                Created By
              </TableCell>
            }

            {/* Status */}
            <TableCell>
              <SortableHeader
                label="Status"
                column="status"
                sortConfig={sortConfig}
                onSortRequest={onSortRequest}
              />
            </TableCell>

            {/* Due Date */}
            <TableCell
              sx={{
                display: {
                  xs: "none",
                  sm: "table-cell",
                },
              }}
            >
              <SortableHeader
                label="Due Date"
                column="dueDate"
                sortConfig={sortConfig}
                onSortRequest={onSortRequest}
              />
            </TableCell>

            {/* Actions */}
            <TableCell align="center">Actions</TableCell>
          </TableRow>
        </TableHead>

        <TableBody>
          {items.length === 0 ?
            <TableRow>
              <TableCell
                colSpan={8}
                align="center"
                sx={{
                  py: 4,
                  color: "text.secondary",
                }}
              >
                No action items found.
              </TableCell>
            </TableRow>
            : items.map((item) => {
              const isClosedOrDiscarded = ["Closed", "Discarded"].includes(item.status);
              const hasEditPermissions =
                (item.createdById === userId && tab === "project-items") || isSuperuser || isAdmin || isManager || (isLead && tab !== 'project-items');
              const tooltipTitle = !isClosedOrDiscarded && hasEditPermissions ? "View / Edit" : "View";

              return (
                <ActionItemRow
                  key={item.id}
                  item={item}
                  tab={tab}
                  userRole={userRole}
                  handleClick={onOpenDetail}
                  tooltipTitle={tooltipTitle}
                  relatedName={item.relatedName || "-"}
                  handleTransitionClick={handleTransitionClick}
                />
              );
            })
          }
        </TableBody>
      </Table>

      <TablePagination
        component="div"
        count={totalItems}
        page={totalItems > 0 ? page - 1 : 0}
        onPageChange={(_, newPage) => {
          onPageChange(newPage + 1);
        }}
        rowsPerPage={limit}
        rowsPerPageOptions={[limit]}
      />
    </TableContainer>
  );
};

export default ActionItemTable;
