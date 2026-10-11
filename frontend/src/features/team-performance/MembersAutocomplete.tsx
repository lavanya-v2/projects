import {
  Autocomplete,
  Box,
  Checkbox,
  Chip,
  ListItemText,
  Paper,
  TextField,
} from '@mui/material';
import { CheckBox, CheckBoxOutlineBlank } from '@mui/icons-material';

interface Props {
  teamMembers: any[];
  value: any[];
  onChange: (v: any[]) => void;
  loading?: boolean;
  disabled?: boolean;
  label?: string;
}

/** Members multi-select with Select All toggle */
export function MembersAutocomplete({
  teamMembers,
  value,
  onChange,
  loading,
  disabled,
  label,
}: Props) {
  return (
    <Autocomplete
      multiple
      disableCloseOnSelect
      size="small"
      sx={{ minWidth: 320 }}
      options={teamMembers}
      loading={loading}
      disabled={disabled}
      getOptionLabel={(m: any) => `${m.firstName} ${m.lastName}`}
      isOptionEqualToValue={(a: any, b: any) => a.jiraLoginId === b.jiraLoginId}
      value={value}
      onChange={(_, val) => onChange(val)}
      renderOption={(props, option, { selected }) => {
        const { key, ...rest } = props as any;
        return (
          <li key={key} {...rest}>
            <Checkbox
              icon={<CheckBoxOutlineBlank fontSize="small" />}
              checkedIcon={<CheckBox fontSize="small" />}
              checked={selected}
              sx={{ mr: 1, p: 0.5 }}
            />
            <ListItemText primary={`${option.firstName} ${option.lastName}`} />
          </li>
        );
      }}
      renderTags={(selected, getTagProps) =>
        selected.length === teamMembers.length
          ? [
              <Chip
                key="all"
                label={`All members (${selected.length})`}
                size="small"
                color="primary"
              />,
            ]
          : selected.length > 2
          ? [
              <Chip
                key="count"
                label={`${selected.length} members selected`}
                size="small"
                color="primary"
              />,
            ]
          : selected.map((m: any, i) => {
              const { key, ...tagProps } = getTagProps({ index: i }) as any;
              return (
                <Chip
                  key={key}
                  label={`${m.firstName} ${m.lastName}`}
                  size="small"
                  {...tagProps}
                />
              );
            })
      }
      PaperComponent={({ children, ...paperProps }) => (
        <Paper {...paperProps}>
          {teamMembers.length > 0 && (
            <Box
              sx={{
                px: 1.5,
                py: 0.75,
                borderBottom: '1px solid',
                borderColor: 'divider',
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' },
              }}
              onMouseDown={e => {
                e.preventDefault();
                onChange(value.length === teamMembers.length ? [] : [...teamMembers]);
              }}
            >
              <Checkbox
                icon={<CheckBoxOutlineBlank fontSize="small" />}
                checkedIcon={<CheckBox fontSize="small" />}
                indeterminate={value.length > 0 && value.length < teamMembers.length}
                checked={value.length === teamMembers.length}
                sx={{ p: 0.5 }}
              />
              <ListItemText
                primary={
                  value.length === teamMembers.length
                    ? `Deselect All (${teamMembers.length})`
                    : `Select All (${teamMembers.length})`
                }
                primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }}
              />
            </Box>
          )}
          {children}
        </Paper>
      )}
      renderInput={params => (
        <TextField
          {...params}
          label={label ?? 'Team Members'}
          placeholder={value.length === 0 ? 'Search or select members…' : ''}
        />
      )}
    />
  );
}
