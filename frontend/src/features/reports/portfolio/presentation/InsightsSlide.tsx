import { Box, Grid, Typography } from '@mui/material';
import { CustomSectionRenderer } from '../../shared/customSections/CustomSectionRenderer';
import { sectionSpan, type CustomSection } from '../../shared/customSections/types';

// Renders one page of custom sections. `sections` is already the chunk for this
// page (max PAGE_UNITS half-cells); buildSlides paginates and passes each chunk.
export function InsightsSlide({ sections }: { sections: CustomSection[] }) {
  if (!Array.isArray(sections) || sections.length === 0) {
    return (
      <Typography color="text.secondary" variant="body2">
        No additional sections have been added to this presentation.
      </Typography>
    );
  }

  return (
    <Box>
      <Grid container spacing={2}>
        {sections.map((section, i) => {
          // A lone section on the page always takes the full width.
          const span = sections.length === 1 ? 12 : sectionSpan(section);
          const base = sections.length <= 2 ? 320 : 240;
          // Tilted X-axis labels eat into the plot area; give dense charts the room back.
          const dense = section.displayMode === 'chart' && (section.rows?.length ?? 0) > 6;
          return (
            <Grid key={section.id ?? i} size={{ xs: 12, md: span }}>
              <CustomSectionRenderer section={section} height={dense ? base + 60 : base} />
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}
