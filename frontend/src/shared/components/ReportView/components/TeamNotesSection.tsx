import { Box, Typography, TextField, Button } from '@mui/material';
import type { TeamNotesController } from '../hooks/useTeamNotes';

interface TeamNotesSectionProps {
    notes: TeamNotesController;
}

export const TeamNotesSection = ({ notes }: TeamNotesSectionProps) => {
    const {
        resolvedReportId,
        teamNotes,
        teamNoteText,
        setTeamNoteText,
        postingNote,
        handlePostTeamNote,
    } = notes;

    return (
        <Box sx={{ mt: 2.5, pt: 2, borderTop: '1px solid #f1f5f9' }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5, color: '#263238' }}>
                Team Notes
            </Typography>
            {teamNotes.length === 0 && (
                <Typography variant="body2" color="text.secondary" fontStyle="italic" sx={{ mb: 1.5 }}>
                    No team notes yet.
                </Typography>
            )}
            {teamNotes.map((note, idx) => (
                <Box key={idx} sx={{ display: 'flex', gap: 1.25, mb: 1.5 }}>
                    <Box
                        sx={{
                            width: 28,
                            height: 28,
                            borderRadius: '50%',
                            bgcolor: '#e3f2fd',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 11,
                            fontWeight: 700,
                            color: '#1565c0',
                            flexShrink: 0,
                        }}
                    >
                        {note.name
                            .split(' ')
                            .map(n => n[0])
                            .join('')
                            .toUpperCase()
                            .slice(0, 2)}
                    </Box>
                    <Box sx={{ flex: 1 }}>
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline' }}>
                            <Typography variant="body2" fontWeight={700} sx={{ color: '#263238' }}>
                                {note.name}
                            </Typography>
                            <Typography variant="caption" sx={{ color: '#546e7a' }}>
                                {new Date(note.timestamp).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                })}
                            </Typography>
                        </Box>
                        <Typography
                            variant="body1"
                            sx={{ mt: 0.5, color: '#1a1a1a', fontSize: '0.95rem', lineHeight: 1.6 }}
                        >
                            {note.text}
                        </Typography>
                    </Box>
                </Box>
            ))}
            {resolvedReportId && (
                <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                    <TextField
                        size="small"
                        fullWidth
                        multiline
                        maxRows={3}
                        placeholder="Add a team observation..."
                        value={teamNoteText}
                        onChange={e => setTeamNoteText(e.target.value)}
                        disabled={postingNote}
                    />
                    <Button
                        variant="outlined"
                        size="small"
                        onClick={handlePostTeamNote}
                        disabled={!teamNoteText.trim() || postingNote}
                        sx={{ alignSelf: 'flex-end', whiteSpace: 'nowrap' }}
                    >
                        Post Note
                    </Button>
                </Box>
            )}
        </Box>
    );
};
