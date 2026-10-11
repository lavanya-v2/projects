import { arrayMove } from "@dnd-kit/sortable";
import { Delete, Add } from "@mui/icons-material";
import {
  Button,
  Table,
  Box,
  Paper,
  Typography,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TextField,
  Select,
  MenuItem,
  IconButton,
  FormControl,
  FormHelperText,
} from "@mui/material";
import RichTextEditor from "../../../../shared/components/RichTextEditor";
import { StringListEditor } from "../../../../shared/components/stringListEditor";
import {
  SortableRows,
  SortableRow,
  DragHandleCell,
} from "../../shared/SortableRows";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import type {
  PortfolioPresentationFormData,
  PortfolioRiskSnapshot,
} from "../types";

export function HighlightsAndRisks() {
  const {
    control,
    getValues,
    setValue,
    formState: { errors },
  } = useFormContext<PortfolioPresentationFormData>();
  const risks = useWatch({ control, name: "risks" });
  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Controller
        name="keyHighlights.summary"
        control={control}
        render={({ field }) => (
          <Box>
            <RichTextEditor
              label="Executive Summary"
              value={field.value || ""}
              onChange={field.onChange}
              minRows={3}
            />
            {errors.keyHighlights?.summary?.message && (
              <FormHelperText error>
                {errors.keyHighlights.summary.message}
              </FormHelperText>
            )}
          </Box>
        )}
      />
      <Controller
        name="keyHighlights.achievements"
        control={control}
        render={({ field }) => (
          <Box>
            <StringListEditor
              label="Achievements"
              values={field.value || []}
              onChange={field.onChange}
              placeholder="e.g. Migrated 3 legacy endpoints to new auth framework"
            />
            {errors.keyHighlights?.achievements?.message && (
              <FormHelperText error>
                {errors.keyHighlights.achievements.message}
              </FormHelperText>
            )}
          </Box>
        )}
      />
      <Controller
        name="keyHighlights.blockers"
        control={control}
        render={({ field }) => (
          <Box>
            <StringListEditor
              label="Blockers"
              values={field.value || []}
              onChange={field.onChange}
              placeholder="e.g. [LOT] Payment gateway SLA breach"
            />
            {errors.keyHighlights?.blockers?.message && (
              <FormHelperText error>
                {errors.keyHighlights.blockers.message}
              </FormHelperText>
            )}
          </Box>
        )}
      />
      <Controller
        name="keyHighlights.capacityNotes"
        control={control}
        render={({ field }) => (
          <Box>
            <StringListEditor
              label="Capacity Notes"
              values={field.value || []}
              onChange={field.onChange}
              placeholder="e.g. Team capacity reduced 15% due to holidays"
            />
            {errors.keyHighlights?.capacityNotes?.message && (
              <FormHelperText error>
                {errors.keyHighlights.capacityNotes.message}
              </FormHelperText>
            )}
          </Box>
        )}
      />

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Risks ({risks.length})
        </Typography>
        <SortableRows
          count={risks.length}
          onReorder={(from, to) =>
            setValue("risks", arrayMove(getValues("risks"), from, to), {
              shouldDirty: true,
            })
          }
        >
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: "#f7f9fc" }}>
                <TableCell sx={{ width: 36, px: 0.5 }} />
                <TableCell>
                  <strong>Project</strong>
                </TableCell>
                <TableCell>
                  <strong>Title</strong>
                </TableCell>
                <TableCell>
                  <strong>Priority</strong>
                </TableCell>
                <TableCell>
                  <strong>Status</strong>
                </TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {risks.map((r, i) => (
                <SortableRow key={i} index={i}>
                  {({ setNodeRef, style, dragHandleProps }) => (
                    <TableRow ref={setNodeRef} style={style}>
                      <DragHandleCell dragHandleProps={dragHandleProps} />
                      <TableCell>
                        <TextField
                          size="small"
                          error={!!errors.risks?.[i]?.projectName}
                          helperText={errors.risks?.[i]?.projectName?.message}
                          value={r.projectName || ""}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          fullWidth
                          error={!!errors.risks?.[i]?.title}
                          helperText={errors.risks?.[i]?.title?.message}
                          value={r.title || ""}
                          onChange={(e) =>
                            setValue(
                              "risks",
                              getValues("risks").map((x, idx) =>
                                idx === i ? { ...x, title: e.target.value } : x,
                              ),
                              { shouldDirty: true },
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <FormControl
                          size="small"
                          error={!!errors.risks?.[i]?.priority}
                        >
                          <Select
                            value={r.priority || "MEDIUM"}
                            onChange={(e) =>
                              setValue(
                                "risks",
                                getValues("risks").map((x, idx) =>
                                  idx === i
                                    ? {
                                        ...x,
                                        priority: e.target
                                          .value as PortfolioRiskSnapshot["priority"],
                                      }
                                    : x,
                                ),
                                { shouldDirty: true },
                              )
                            }
                          >
                            <MenuItem value="CRITICAL">CRITICAL</MenuItem>
                            <MenuItem value="HIGH">HIGH</MenuItem>
                            <MenuItem value="MEDIUM">MEDIUM</MenuItem>
                            <MenuItem value="LOW">LOW</MenuItem>
                          </Select>
                          <FormHelperText>
                            {errors.risks?.[i]?.priority?.message}
                          </FormHelperText>
                        </FormControl>
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          error={!!errors.risks?.[i]?.status}
                          helperText={errors.risks?.[i]?.status?.message}
                          value={r.status || ""}
                          onChange={(e) =>
                            setValue(
                              "risks",
                              getValues("risks").map((x, idx) =>
                                idx === i
                                  ? {
                                      ...x,
                                      status: e.target
                                        .value as PortfolioRiskSnapshot["status"],
                                    }
                                  : x,
                              ),
                              { shouldDirty: true },
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <IconButton
                          size="small"
                          onClick={() =>
                            setValue(
                              "risks",
                              getValues("risks").filter((_, idx) => idx !== i),
                              { shouldDirty: true },
                            )
                          }
                        >
                          <Delete fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  )}
                </SortableRow>
              ))}
            </TableBody>
          </Table>
        </SortableRows>
        <Button
          size="small"
          startIcon={<Add />}
          onClick={() =>
            setValue(
              "risks",
              [
                ...getValues("risks"),
                {
                  projectName: "",
                  title: "",
                  priority: "MEDIUM",
                  status: "NEW",
                  description: "",
                  source: "INTERNAL",
                },
              ],
              { shouldDirty: true },
            )
          }
        >
          Add risk
        </Button>
      </Paper>
    </Box>
  );
}
