import React, { useState } from "react";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Popover,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { ACTION_ITEM_CATEGORIES } from "./ActionItemDetailModal";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import FilterAltIcon from "@mui/icons-material/FilterAlt";

interface FilterOption {
  id: string | number;
  name: string;
}

interface SearchFilterProps {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClick?: () => void;
  onClear?: () => void;
  open?: boolean;
  activeFilter?: boolean;
  handlePopOverClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

interface ActionItemFiltersProps {
  onSearch: (value: string) => void;
  onClearSearch: () => void;
  open: boolean;
  anchorEl: HTMLElement | null;
  onPopoverOpen: (event: React.MouseEvent<HTMLElement>) => void;
  onPopoverClose: () => void;
  entityLabel?: string;
  entityValue?: string | number;
  entityOptions?: FilterOption[];
  onEntityChange?: (value: string) => void;
  entityPosition?: "outside" | "inside";
  statusFilter: string[];
  onStatusChange: (value: string[]) => void;
  categoryFilter: string[];
  onCategoryChange: (value: string[]) => void;
  activeFilters: boolean;
  hasFilterChanges: boolean;
  onApply: () => void;
  onClear: () => void;
}

const STATUS_OPTIONS = ["Open", "In-Progress", "Closed", "Discarded"];

function SearchFilterForm({ value, onChange, onClick, onClear, open, activeFilter, handlePopOverClick
}: SearchFilterProps) {

  return (
    <>
      <Box
        sx={{
          display: "flex",
          gap: 1.5,
          mb: 2.5,
          alignItems: { xs: "stretch", sm: "center" },
          flexWrap: "wrap",
          flexDirection: { xs: "column", sm: "row" },
        }}
      >
        <TextField
          size="small"
          placeholder="Search by title"
          value={value}
          onChange={onChange}
          sx={{
            width: { xs: "100%", sm: 300 },
            "& .MuiOutlinedInput-root": {
              borderRadius: 1.5,
              fontSize: 13,
              fontFamily: "Inter, sans-serif",
              "& fieldset": { borderColor: "#e0e4ea" },
              "&:hover fieldset": { borderColor: "#9ca3af" },
              "&.Mui-focused fieldset": { borderColor: "navy" },
            },
          }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" sx={{ color: "#9ca3af" }} />
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  {value && (
                    <IconButton onClick={onClear} size="small">
                      <ClearIcon fontSize="small" sx={{ color: "#9ca3af" }} />
                    </IconButton>
                  )}
                  <IconButton
                    onClick={handlePopOverClick}
                    color={open ? "primary" : "default"}
                  >
                    <Badge
                      variant="dot"
                      color="error"
                      invisible={!activeFilter}
                      anchorOrigin={{
                        vertical: "top",
                        horizontal: "right",
                      }}
                    >
                      <FilterAltIcon />
                    </Badge>
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />

        <Button
          variant="contained"
          startIcon={<SearchIcon />}
          onClick={onClick}
          size="small"
        >
          Search
        </Button>
      </Box>
    </>
  );
}

const ActionItemFilters = ({
  onSearch,
  onClearSearch,
  open,
  anchorEl,
  onPopoverOpen,
  onPopoverClose,
  entityLabel,
  entityValue,
  entityOptions = [],
  onEntityChange,
  entityPosition = "inside",
  statusFilter,
  onStatusChange,
  categoryFilter,
  onCategoryChange,
  activeFilters,
  hasFilterChanges,
  onApply,
  onClear,
}: ActionItemFiltersProps) => {
  const [searchText, setSearchText] = useState('');

  const renderEntityFilter = () => {
    if (!entityLabel || !onEntityChange) {
      return null;
    }

    return (
      <TextField
        select
        label={entityLabel}
        value={entityValue ?? "all"}
        onChange={(event) => onEntityChange(event.target.value)}
        sx={{
          minWidth: {
            xs: "100%",
            sm: 200,
          },
        }}
        size="small"
      >
        <MenuItem value="all">All {entityLabel}s</MenuItem>

        {entityOptions.map((option) => (
          <MenuItem key={option.id} value={option.id}>
            {option.name}
          </MenuItem>
        ))}
      </TextField>
    );
  };

  return (
    <Box
      sx={{
        display: "flex",
        gap: 2,
        mb: 1,
        flexWrap: "wrap",
        flexDirection: {
          xs: "column",
          sm: "row",
        },
      }}
    >
      {/* Account filter */}
      {entityPosition === "outside" && renderEntityFilter()}

      {/* Search */}
      <SearchFilterForm
        value={searchText}
        onChange={(event) => setSearchText(event.target.value)}
        onClick={() => onSearch(searchText)}
        onClear={() => { setSearchText(""); onClearSearch(); }}
        open={open}
        activeFilter={activeFilters}
        handlePopOverClick={onPopoverOpen}
      />

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={onPopoverClose}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "left",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "left",
        }}
        slotProps={{
          paper: {
            sx: {
              p: 2.5,
              minWidth: { xs: "100%", sm: 140 },
            },
          },
        }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: "bold", mb: 2 }}>
          Filters
        </Typography>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={2.5}>
          {/* Project / Program */}
          {entityPosition === "inside" && renderEntityFilter()}

          {/* Status */}
          <FormControl
            size="small"
            sx={{
              minWidth: { xs: "100%", sm: 160 },
              maxWidth: { xs: "100%", sm: 240 },
            }}
          >
            <InputLabel> Status Filter </InputLabel>

            <Select
              multiple
              value={statusFilter}
              label="Status Filter"
              input={<OutlinedInput label="Status Filter" />}
              onChange={(event) =>
                onStatusChange(event.target.value as string[])
              }
              renderValue={(selected) => (selected as string[]).join(", ")}
            >
              {STATUS_OPTIONS.map((status) => (
                <MenuItem key={status} value={status}>
                  <Checkbox checked={statusFilter.includes(status)} size="small" />

                  <ListItemText
                    primary={
                      status === "Open" ? "Open only"
                        : status === "In-Progress" ?
                          "In-Progress only"
                          : status
                    }
                  />
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Category */}
          <FormControl
            size="small"
            sx={{
              minWidth: { xs: "100%", sm: 160 },
              maxWidth: { xs: "100%", sm: 240 },
            }}
          >
            <InputLabel> Category Filter </InputLabel>

            <Select
              multiple
              value={categoryFilter}
              label="Category Filter"
              input={<OutlinedInput label="Category Filter" />}
              onChange={(event) =>
                onCategoryChange(event.target.value as string[])
              }
              renderValue={(selected) => (selected as string[]).join(", ")}
            >
              {ACTION_ITEM_CATEGORIES.map((category) => (
                <MenuItem key={category} value={category}>
                  <Checkbox
                    checked={categoryFilter.includes(category)}
                    size="small"
                  />

                  <ListItemText primary={category} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>

        {/* Buttons */}
        <Stack
          direction="row"
          spacing={1}
          justifyContent="space-between"
          sx={{ pt: 1 }}
        >
          <Button size="small" color="error" onClick={onClear}>
            Clear All
          </Button>

          <Button variant="contained" size="small" disabled={!hasFilterChanges} onClick={onApply}>
            Apply
          </Button>
        </Stack>
      </Popover>
    </Box>
  );
};

export default ActionItemFilters;
