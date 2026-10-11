import { useState } from 'react';
import {
  Box, Button, FormControlLabel, Paper, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import { VisibilityOffRounded } from '@mui/icons-material';

interface Props {
  laneKey: string;
  laneName: string;
  allowAnonymous: boolean;
  onSubmit: (content: string, isAnonymous: boolean) => Promise<void>;
}

export default function RetroItemComposer({ laneKey, laneName, allowAnonymous, onSubmit }: Props) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!content.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit(content.trim(), anonymous);
      setContent('');
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <Button
        fullWidth
        size="small"
        variant="outlined"
        data-testid={`add-item-${laneKey}`}
        onClick={() => setOpen(true)}
        sx={{ mt: 1, borderStyle: 'dashed' }}
      >
        + Add to {laneName}
      </Button>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.5, mt: 1 }}>
      <TextField
        autoFocus
        fullWidth
        multiline
        minRows={2}
        size="small"
        placeholder="What would you like to share?"
        value={content}
        onChange={e => setContent(e.target.value)}
        inputProps={{ maxLength: 2000, 'data-testid': `composer-input-${laneKey}` }}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          if (e.key === 'Escape') setOpen(false);
        }}
      />

      {allowAnonymous && (
        <Tooltip title="We will not record who wrote this. That also means it cannot be edited later.">
          <FormControlLabel
            sx={{ mt: 0.5 }}
            control={
              <Switch
                size="small"
                checked={anonymous}
                onChange={e => setAnonymous(e.target.checked)}
                inputProps={{ 'aria-label': 'Post anonymously' } as never}
                data-testid={`anon-toggle-${laneKey}`}
              />
            }
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <VisibilityOffRounded sx={{ fontSize: 15 }} />
                <Typography variant="caption">Post anonymously</Typography>
              </Box>
            }
          />
        </Tooltip>
      )}

      {anonymous && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Your name will not be stored. You can withdraw this for 60 seconds; after that it
          cannot be edited or deleted, because there is no record of who posted it.
        </Typography>
      )}

      <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
        <Button
          size="small"
          variant="contained"
          disabled={!content.trim() || saving}
          onClick={submit}
          data-testid={`composer-submit-${laneKey}`}
        >
          {saving ? 'Adding…' : 'Add'}
        </Button>
        <Button size="small" onClick={() => { setOpen(false); setContent(''); }}>
          Cancel
        </Button>
      </Box>
    </Paper>
  );
}
