import { arrayMove } from "@dnd-kit/sortable";
import { Delete } from "@mui/icons-material";
import {
  Box,
  Paper,
  Typography,
  Alert,
  Stack,
  TextField,
  IconButton,
  Chip,
  FormControl,
  InputLabel,
  FormHelperText,
  Select,
  MenuItem,
  Tooltip,
} from "@mui/material";
import { LocalizationProvider, DatePicker } from "@mui/x-date-pickers";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import dayjs from "dayjs";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { StringListEditor } from "../../../../shared/components/stringListEditor";
import {
  SortableRows,
  SortableRow,
  DragHandleButton,
} from "../../shared/SortableRows";
import type {
  PortfolioActionItemSnapshot,
  PortfolioPresentationFormData,
} from "../types";
import { useState } from "react";

const ACTION_ITEM_CATEGORIES = [
  'Task',
  'Follow-up',
  'Decision required',
  'Issue',
  'Risk & mitigation',
  'Dependency',
];

const ACTION_ITEM_STATUS = [
  'Open',
  'In-Progress',
  'Closed',
  'Discarded',
];

export function ActionItemAndTech() {
  const {
    control,
    getValues,
    setValue,
    formState: { errors },
  } = useFormContext<PortfolioPresentationFormData>();
  const actionItems = useWatch({ control, name: "actionItemsSnapshot" });
  const techRecs = useWatch({ control, name: "techRecommendations" });
  const discussion = useWatch({ control, name: "discussionPoints" });
  const setActionItems = (items: PortfolioActionItemSnapshot[]) =>
    setValue("actionItemsSnapshot", items, { shouldDirty: true });
  const setItemAt = (
    index: number,
    patch: Partial<PortfolioActionItemSnapshot>,
  ) =>
    setActionItems(
      getValues("actionItemsSnapshot").map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );

  const [dueDateError, setDueDateError] = useState<{
    id: string | null;
    message: string;
  }>({ id: null, message: "" });

  const formatDueDate = (dateValue: string | null | undefined) => {
    return dateValue ? dayjs(dateValue) : null;
  };

  const handleEditDateChange = (
    newDueDate: dayjs.Dayjs | null,
    setItem: (patch: Partial<PortfolioActionItemSnapshot>) => void,
    actionItem: PortfolioActionItemSnapshot,
  ) => {
    const setDueDate = newDueDate ? newDueDate.toISOString() : "";
    let err = "";
    if (newDueDate && dayjs(newDueDate).isAfter(dayjs().add(3, "month"))) {
      err = `Due date should be within 3 months from today's date`;
    } else if (
      newDueDate &&
      dayjs(newDueDate).isBefore(dayjs().subtract(1, "day"))
    ) {
      err = `Due date cannot be past date from today's date`;
    } else {
      setItem({ dueDate: setDueDate });
    }
    setDueDateError({
      id: String(actionItem.id),
      message: err,
    });
  };

  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Action Items ({actionItems.length})
        </Typography>
        <Alert severity="info" sx={{ mb: 1.5 }}>
          Action items are pulled from the Action Items section. Editing Title /
          Owner / Category / Due here updates the linked action item; the Status
          dropdown changes this slide only. To add a new action item, create it
          in the Project or Program Action Items section, then click
          &ldquo;Refresh data from system&rdquo;.
        </Alert>
        {actionItems.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No action items. Use &ldquo;Refresh data from system&rdquo; to pull
            open items for the selected projects.
          </Typography>
        )}
        <SortableRows
          count={actionItems.length}
          onReorder={(from, to) =>
            setActionItems(
              arrayMove(getValues("actionItemsSnapshot"), from, to),
            )
          }
        >
          <Stack spacing={1.5}>
            {actionItems.map((actionItem, i) => {
              const setItem = (patch: Partial<PortfolioActionItemSnapshot>) =>
                setItemAt(i, patch);
              return (
                <SortableRow key={i} index={i}>
                  {({ setNodeRef, style, dragHandleProps }) => (
                    <Paper
                      ref={setNodeRef}
                      style={style}
                      variant="outlined"
                      sx={{ p: 1.5, bgcolor: "#fafbfc" }}
                    >
                      <Box
                        sx={{
                          display: "flex",
                          gap: 1,
                          alignItems: "flex-start",
                        }}
                      >
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            mt: 0.5,
                          }}
                        >
                          <DragHandleButton dragHandleProps={dragHandleProps} />
                        </Box>
                        <TextField
                          label="Action item"
                          size="small"
                          fullWidth
                          multiline
                          minRows={2}
                          error={!!errors.actionItemsSnapshot?.[i]?.title}
                          helperText={
                            errors.actionItemsSnapshot?.[i]?.title?.message
                          }
                          value={actionItem.title || ""}
                          onChange={(e) => setItem({ title: e.target.value })}
                        />
                        <Tooltip title="Remove from this presentation">
                          <IconButton
                            size="small"
                            sx={{ mt: 0.5 }}
                            onClick={() =>
                              setActionItems(
                                getValues("actionItemsSnapshot").filter(
                                  (_, idx) => idx !== i,
                                ),
                              )
                            }
                          >
                            <Delete fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                      <Box
                        sx={{
                          display: "flex",
                          gap: 1.5,
                          flexWrap: "wrap",
                          mt: 1.5,
                          alignItems: "flex-start",
                        }}
                      >
                        <Chip
                          size="small"
                          label={actionItem.source === "program" ? "Program" : "Project"}
                          color={
                            actionItem.source === "program" ? "secondary" : "default"
                          }
                        />
                        <Typography
                          variant="body2"
                          sx={{ minWidth: 120, color: "text.secondary" }}
                        >
                          {actionItem.projectName || "—"}
                        </Typography>
                        <TextField
                          label="Owner"
                          size="small"
                          sx={{ minWidth: 150 }}
                          error={!!errors.actionItemsSnapshot?.[i]?.owner}
                          helperText={
                            errors.actionItemsSnapshot?.[i]?.owner?.message
                          }
                          value={actionItem.owner || ""}
                          onChange={(e) => setItem({ owner: e.target.value })}
                        />
                        <Controller
                          name={`actionItemsSnapshot.${i}.category`}
                          control={control}
                          render={({ field }) => (
                            <FormControl
                              size="small"
                              sx={{ minWidth: 150 }}
                              error={
                                !!errors.actionItemsSnapshot?.[i]?.category
                              }
                            >
                              <InputLabel>Category</InputLabel>
                              <Select {...field} label="Category">
                                {ACTION_ITEM_CATEGORIES.map((category) => (
                                  <MenuItem key={category} value={category}>
                                    {category}
                                  </MenuItem>
                                ))}
                              </Select>
                              <FormHelperText>
                                {
                                  errors.actionItemsSnapshot?.[i]?.category
                                    ?.message
                                }
                              </FormHelperText>
                            </FormControl>
                          )}
                        />
                        <Controller
                          name={`actionItemsSnapshot.${i}.status`}
                          control={control}
                          render={({ field }) => (
                            <FormControl
                              size="small"
                              sx={{ minWidth: 150 }}
                              error={!!errors.actionItemsSnapshot?.[i]?.status}
                            >
                              <InputLabel>Status</InputLabel>
                              <Select {...field} label="Status">
                                {ACTION_ITEM_STATUS.map((status)=> (
                                  <MenuItem key={status} value={status}>
                                    {status}
                                  </MenuItem>
                                ))}
                              </Select>
                              <FormHelperText>
                                {
                                  errors.actionItemsSnapshot?.[i]?.status
                                    ?.message
                                }
                              </FormHelperText>
                            </FormControl>
                          )}
                        />
                        <LocalizationProvider dateAdapter={AdapterDayjs}>
                          <Controller
                            name={`actionItemsSnapshot.${i}.dueDate`}
                            control={control}
                            render={({ field }) => (
                              <DatePicker
                                label="Due"
                                value={formatDueDate(field.value)}
                                onChange={(date) =>
                                  handleEditDateChange(
                                    date,
                                    (patch) =>
                                      setValue(
                                        `actionItemsSnapshot.${i}.dueDate`,
                                        patch.dueDate ?? null,
                                        { shouldDirty: true },
                                      ),
                                    actionItem,
                                  )
                                }
                                minDate={dayjs()}
                                maxDate={dayjs().add(3, "month")}
                                slotProps={{
                                  textField: {
                                    size: "small",
                                    error:
                                      !!errors.actionItemsSnapshot?.[i]
                                        ?.dueDate ||
                                      (actionItem.id != null &&
                                        dueDateError.id === String(actionItem.id) &&
                                        !!dueDateError.message),
                                    helperText:
                                      errors.actionItemsSnapshot?.[i]?.dueDate
                                        ?.message ||
                                      (actionItem.id != null &&
                                      dueDateError.id === String(actionItem.id)
                                        ? dueDateError.message
                                        : ""),
                                  },
                                }}
                                sx={{ minWidth: 160 }}
                              />
                            )}
                          />
                        </LocalizationProvider>
                      </Box>
                    </Paper>
                  )}
                </SortableRow>
              );
            })}
          </Stack>
        </SortableRows>
      </Paper>

      <Box>
        <StringListEditor
          label="Tech Recommendations"
          values={techRecs}
          onChange={(e) =>
            setValue("techRecommendations", e, { shouldDirty: true })
          }
          placeholder="e.g. Evaluate read-replica for analytics reporting"
        />
        {errors.techRecommendations?.message && (
          <FormHelperText error>
            {errors.techRecommendations.message}
          </FormHelperText>
        )}
      </Box>

      <Box>
        <StringListEditor
          label="Additional Discussion Points"
          values={discussion}
          onChange={(points) =>
            setValue("discussionPoints", points, { shouldDirty: true })
          }
          minRows={3}
          maxRows={12}
          placeholder={
            "Type a full paragraph if needed — press Enter for new lines.\nLine breaks are preserved in the presentation and PDF."
          }
        />
        {errors.discussionPoints?.message && (
          <FormHelperText error>
            {errors.discussionPoints.message}
          </FormHelperText>
        )}
      </Box>
    </Box>
  );
}
