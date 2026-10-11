import { Add, Delete } from "@mui/icons-material";
import { Box, Typography, Button, Stack, TextField, IconButton } from "@mui/material";

export function StringListEditor({
  label, values, onChange, placeholder = 'Add entry', minRows = 1, maxRows = 3,
}: { label: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string; minRows?: number; maxRows?: number }) {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{label}</Typography>
      {values.length === 0 && (
        <Button size="small" startIcon={<Add />} onClick={() => onChange([''])}>Add first entry</Button>
      )}
      <Stack spacing={1}>
        {values.map((v, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1 }}>
            <TextField
              size="small" fullWidth multiline minRows={minRows} maxRows={maxRows}
              value={v}
              placeholder={placeholder}
              onChange={e => {
                const next = [...values];
                next[i] = e.target.value;
                onChange(next);
              }}
            />
            <IconButton size="small" onClick={() => onChange(values.filter((_, idx) => idx !== i))}>
              <Delete fontSize="small" />
            </IconButton>
          </Box>
        ))}
        {values.length > 0 && (
          <Button size="small" startIcon={<Add />} onClick={() => onChange([...values, ''])}>Add another</Button>
        )}
      </Stack>
    </Box>
  );
}