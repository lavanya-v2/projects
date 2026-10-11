import { arrayMove } from "@dnd-kit/sortable";
import { Refresh, Delete, Add } from "@mui/icons-material";
import {
  Box,
  Paper,
  Typography,
  Divider,
  FormControlLabel,
  Switch,
  Chip,
  Button,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TextField,
  IconButton,
  Stack,
  Checkbox,
  Tooltip,
} from "@mui/material";
import { useFormContext, useWatch } from "react-hook-form";
import type { FieldPath } from "react-hook-form";
import { CustomSectionsEditor } from "../../shared/customSections/CustomSectionsEditor";
import {
  SortableRows,
  SortableRow,
  DragHandleCell,
} from "../../shared/SortableRows";
import { TREND_CHART_DEFS, isChartHidden } from "../presentation/trendCharts";
import type { PortfolioPresentationFormData, TeamCapacityRow } from "../types";

interface Props {
  seedTeamCapacityRows: () => TeamCapacityRow[];
}

export function AdditionalInsights({ seedTeamCapacityRows }: Props) {
  const {
    control,
    setValue,
    getFieldState,
    formState: { errors },
  } = useFormContext<PortfolioPresentationFormData>();
  const hiddenCharts = useWatch({ control, name: "hiddenCharts" });
  const graphNotes = useWatch({ control, name: "graphNotes" });
  const teamCapacityRows = useWatch({ control, name: "teamCapacityRows" });
  const capacityFlags = useWatch({ control, name: "velocityCapacityFlags" });
  const customSections = useWatch({ control, name: "customSections" });
  const trendData = useWatch({ control, name: "trendData" });
  const selectedProjectIds = useWatch({ control, name: "selectedProjectIds" });
  const drilldown = useWatch({ control, name: "perProjectDrilldown" });
  const singleProjectId =
    selectedProjectIds.length === 1 ? selectedProjectIds[0] : null;
  const teamCapacityEnabled = !isChartHidden(hiddenCharts, "team-capacity");
  // Kanban presentation (every project is Kanban for this date range): the
  // Productivity % graph is not offered, and Team Capacity rows are per cycle.
  const allKanban =
    drilldown.length > 0 &&
    drilldown.every((d: any) => d?.isKanbanEffective === true);
  const kanbanCapacity =
    allKanban || teamCapacityRows.some((r) => r.workingDays != null);
  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700}>
          Trends graphs to include
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mb: 1 }}
        >
          Choose which Trends-slide graphs appear in this presentation. Most are
          on by default; newly added graphs (marked New) start off until you
          enable them. The setting is saved per presentation and carried over
          when cloned.
        </Typography>
        <Divider sx={{ mb: 1 }} />
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {TREND_CHART_DEFS.filter(
            (def) => !(allKanban && def.id === "productivity"),
          ).map((def) => (
            <FormControlLabel
              key={def.id}
              sx={{ width: { xs: "100%", sm: "48%" }, mr: 0 }}
              control={
                <Switch
                  size="small"
                  checked={!isChartHidden(hiddenCharts, def.id)}
                  onChange={(_e, shown) =>
                    setValue(
                      "hiddenCharts",
                      {
                        ...hiddenCharts,
                        [def.id]: !shown,
                      },
                      { shouldDirty: true, shouldValidate: true },
                    )
                  }
                />
              }
              label={
                <Box
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 0.75,
                  }}
                >
                  <Typography variant="body2">{def.label}</Typography>
                  {def.isNew && (
                    <Tooltip title="Newly added and off by default. Turn it on to include it in this presentation.">
                      <Chip
                        label="New"
                        size="small"
                        color="info"
                        sx={{ height: 18, fontSize: 10, fontWeight: 700 }}
                      />
                    </Tooltip>
                  )}
                </Box>
              }
            />
          ))}
        </Box>
      </Paper>

      {/* Current Sprint (in-flight) card — single-project only. For
                    multi-project presentations the card is always shown and this
                    control is hidden. Stored in hiddenCharts under 'current-sprint'
                    (default shown). */}
      {singleProjectId !== null && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            Current Sprint card
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mb: 1 }}
          >
            Show the live Current Sprint (in-flight) card in the project
            drilldown. On by default. Turn it off for a cleaner selected-sprint
            view. For multi-project presentations the card is always shown.
          </Typography>
          <Divider sx={{ mb: 1 }} />
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={!isChartHidden(hiddenCharts, "current-sprint")}
                onChange={(_e, shown) =>
                  setValue(
                    "hiddenCharts",
                    {
                      ...hiddenCharts,
                      ["current-sprint"]: !shown,
                    },
                    { shouldDirty: true, shouldValidate: true },
                  )
                }
              />
            }
            label={
              <Typography variant="body2">
                Show Current Sprint card in project drilldowns
              </Typography>
            }
          />
        </Paper>
      )}

      {/* Technical Recommendations quadrant on the Highlights, Risks &
                    Actions slide. Optional — stored in hiddenCharts under
                    'tech-recommendations' (default shown, so existing
                    presentations are unaffected). */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700}>
          Technical Recommendations
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mb: 1 }}
        >
          Show the Technical Recommendations panel on the Highlights, Risks
          &amp; Actions slide and in the PDF. On by default. Turn it off when
          there is nothing to recommend — Action Items then spans the full row
          instead of leaving a blank panel.
        </Typography>
        <Divider sx={{ mb: 1 }} />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={!isChartHidden(hiddenCharts, "tech-recommendations")}
              onChange={(_e, shown) =>
                setValue(
                  "hiddenCharts",
                  {
                    ...hiddenCharts,
                    ["tech-recommendations"]: !shown,
                  },
                  { shouldDirty: true, shouldValidate: true },
                )
              }
            />
          }
          label={
            <Typography variant="body2">
              Show Technical Recommendations panel
            </Typography>
          }
        />
      </Paper>

      {teamCapacityEnabled && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
              mb: 0.5,
            }}
          >
            <Typography variant="subtitle2" fontWeight={700}>
              Team Capacity table
            </Typography>
            <Button
              size="small"
              startIcon={<Refresh />}
              onClick={() => {
                if (
                  teamCapacityRows.length > 0 &&
                  !window.confirm(
                    "Replace all current rows, including leaves you entered?",
                  )
                )
                  return;
                setValue("teamCapacityRows", seedTeamCapacityRows(), {
                  shouldDirty: true,
                  shouldValidate: true,
                });
              }}
            >
              Re-populate from V2 members
            </Button>
          </Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mb: 1.5 }}
          >
            {kanbanCapacity
              ? "Rows are pre-filled with V2 members, one row per Kanban cycle in the presented date range. Working Days counts Monday to Friday only; Available Days = Working Days minus the leaves you enter. Planned/Unplanned leaves are always entered by you. Add rows for anyone not on a project."
              : "Rows are pre-filled with V2 members. For a single-project, single-sprint presentation the Sprint and Story Points columns are filled from that sprint; otherwise enter them manually. Planned/Unplanned leaves are always entered by you. Add rows for anyone not on a project."}
          </Typography>
          <Divider sx={{ mb: 1 }} />
          <Box sx={{ overflowX: "auto" }}>
            <SortableRows
              count={teamCapacityRows.length}
              onReorder={(from, to) =>
                setValue(
                  "teamCapacityRows",
                  arrayMove(teamCapacityRows, from, to),
                  {
                    shouldDirty: true,
                    shouldValidate: true,
                  },
                )
              }
            >
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: "#f5f5f5" }}>
                    <TableCell sx={{ width: 36, px: 0.5 }} />
                    <TableCell sx={{ fontWeight: 700, minWidth: 160 }}>
                      Name
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, minWidth: 110 }}>
                      {kanbanCapacity ? "Cycle" : "Sprint"}
                    </TableCell>
                    {kanbanCapacity && (
                      <TableCell sx={{ fontWeight: 700, width: 110 }}>
                        Working Days
                      </TableCell>
                    )}
                    <TableCell sx={{ fontWeight: 700, width: 120 }}>
                      Planned Leaves
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 120 }}>
                      Unplanned Leaves
                    </TableCell>
                    {kanbanCapacity && (
                      <TableCell sx={{ fontWeight: 700, width: 110 }}>
                        Available Days
                      </TableCell>
                    )}
                    <TableCell sx={{ fontWeight: 700, width: 130 }}>
                      Story Points Delivered
                    </TableCell>
                    {/* Carry Over SP column hidden for now (data field retained). */}
                    <TableCell sx={{ width: 44 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {teamCapacityRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9}>
                        <Typography variant="caption" color="text.secondary">
                          No rows yet — add one or re-populate from V2 members.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {teamCapacityRows.map((r, i) => (
                    <SortableRow key={i} index={i}>
                      {({ setNodeRef, style, dragHandleProps }) => (
                        <TableRow ref={setNodeRef} style={style}>
                          <DragHandleCell dragHandleProps={dragHandleProps} />
                          <TableCell>
                            <TextField
                              size="small"
                              fullWidth
                              error={!!errors.teamCapacityRows?.[i]?.name}
                              helperText={
                                errors.teamCapacityRows?.[i]?.name?.message
                              }
                              value={r.name}
                              onChange={(e) =>
                                setValue(
                                  "teamCapacityRows",
                                  teamCapacityRows.map((row, rowIndex) =>
                                    rowIndex === i
                                      ? { ...row, name: e.target.value }
                                      : row,
                                  ),
                                  { shouldDirty: true, shouldValidate: true },
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small"
                              fullWidth
                              error={!!errors.teamCapacityRows?.[i]?.sprint}
                              helperText={
                                errors.teamCapacityRows?.[i]?.sprint?.message
                              }
                              value={r.sprint}
                              onChange={(e) =>
                                setValue(
                                  "teamCapacityRows",
                                  teamCapacityRows.map((row, rowIndex) =>
                                    rowIndex === i
                                      ? { ...row, sprint: e.target.value }
                                      : row,
                                  ),
                                  { shouldDirty: true, shouldValidate: true },
                                )
                              }
                            />
                          </TableCell>
                          {kanbanCapacity && (
                            <TableCell>
                              <TextField
                                size="small"
                                type="number"
                                value={r.workingDays ?? ""}
                                onChange={(e) =>
                                  setValue(
                                    "teamCapacityRows",
                                    teamCapacityRows.map((row, rowIndex) =>
                                      rowIndex === i
                                        ? {
                                            ...row,
                                            workingDays:
                                              e.target.value === ""
                                                ? null
                                                : Number(e.target.value),
                                          }
                                        : row,
                                    ),
                                    { shouldDirty: true, shouldValidate: true },
                                  )
                                }
                                sx={{ width: 90 }}
                              />
                            </TableCell>
                          )}
                          <TableCell>
                            <TextField
                              size="small"
                              type="number"
                              error={
                                !!errors.teamCapacityRows?.[i]?.plannedLeaves
                              }
                              helperText={
                                errors.teamCapacityRows?.[i]?.plannedLeaves
                                  ?.message
                              }
                              value={r.plannedLeaves ?? ""}
                              onChange={(e) =>
                                setValue(
                                  "teamCapacityRows",
                                  teamCapacityRows.map((row, rowIndex) =>
                                    rowIndex === i
                                      ? {
                                          ...row,
                                          plannedLeaves:
                                            e.target.value === ""
                                              ? null
                                              : Number(e.target.value),
                                        }
                                      : row,
                                  ),
                                  { shouldDirty: true, shouldValidate: true },
                                )
                              }
                              sx={{ width: 100 }}
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small"
                              type="number"
                              error={
                                !!errors.teamCapacityRows?.[i]?.unplannedLeaves
                              }
                              helperText={
                                errors.teamCapacityRows?.[i]?.unplannedLeaves
                                  ?.message
                              }
                              value={r.unplannedLeaves ?? ""}
                              onChange={(e) =>
                                setValue(
                                  "teamCapacityRows",
                                  teamCapacityRows.map((row, rowIndex) =>
                                    rowIndex === i
                                      ? {
                                          ...row,
                                          unplannedLeaves:
                                            e.target.value === ""
                                              ? null
                                              : Number(e.target.value),
                                        }
                                      : row,
                                  ),
                                  { shouldDirty: true, shouldValidate: true },
                                )
                              }
                              sx={{ width: 100 }}
                            />
                          </TableCell>
                          {kanbanCapacity && (
                            <TableCell>
                              <Typography variant="body2">
                                {r.workingDays == null
                                  ? "—"
                                  : Math.max(
                                      0,
                                      (r.workingDays ?? 0) -
                                        (r.plannedLeaves ?? 0) -
                                        (r.unplannedLeaves ?? 0),
                                    )}
                              </Typography>
                            </TableCell>
                          )}
                          <TableCell>
                            <TextField
                              size="small"
                              type="number"
                              error={
                                !!errors.teamCapacityRows?.[i]
                                  ?.storyPointsDelivered
                              }
                              helperText={
                                errors.teamCapacityRows?.[i]
                                  ?.storyPointsDelivered?.message
                              }
                              value={r.storyPointsDelivered ?? ""}
                              onChange={(e) =>
                                setValue(
                                  "teamCapacityRows",
                                  teamCapacityRows.map((row, rowIndex) =>
                                    rowIndex === i
                                      ? {
                                          ...row,
                                          storyPointsDelivered:
                                            e.target.value === ""
                                              ? null
                                              : Number(e.target.value),
                                        }
                                      : row,
                                  ),
                                  { shouldDirty: true, shouldValidate: true },
                                )
                              }
                              sx={{ width: 110 }}
                            />
                          </TableCell>
                          {/* Carry Over SP input hidden for now (data field retained). */}
                          <TableCell>
                            <IconButton
                              size="small"
                              onClick={() =>
                                setValue(
                                  "teamCapacityRows",
                                  teamCapacityRows.filter(
                                    (_, rowIndex) => rowIndex !== i,
                                  ),
                                  {
                                    shouldDirty: true,
                                    shouldValidate: true,
                                  },
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
          </Box>
          <Button
            size="small"
            startIcon={<Add />}
            onClick={() =>
              setValue(
                "teamCapacityRows",
                [
                  ...teamCapacityRows,
                  {
                    name: "",
                    jiraLoginId: null,
                    sprint: "",
                    plannedLeaves: null,
                    unplannedLeaves: null,
                    storyPointsDelivered: null,
                    carryOverSp: null,
                  },
                ],
                {
                  shouldDirty: true,
                  shouldValidate: true,
                },
              )
            }
            sx={{ mt: 1 }}
          >
            Add row
          </Button>
        </Paper>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700}>
          Graph notes (shown on slide)
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mb: 1 }}
        >
          Optional free-text note rendered under each Trends graph on the slide
          and in the PDF. Presentation-only — leave blank to show nothing.
        </Typography>
        <Divider sx={{ mb: 1.5 }} />
        <Stack spacing={1.5}>
          {/* Velocity note lives in the capacity section below where it's in context. */}
          {TREND_CHART_DEFS.filter((def) => def.id !== "velocity-trend").map(
            (def) => (
              <TextField
                key={def.id}
                size="small"
                fullWidth
                multiline
                minRows={1}
                maxRows={3}
                label={def.label}
                placeholder="Optional note"
                error={!!errors.graphNotes?.[def.id]}
                helperText={errors.graphNotes?.[def.id]?.message}
                value={graphNotes[def.id] ?? ""}
                onChange={(e) =>
                  setValue(
                    "graphNotes",
                    {
                      ...graphNotes,
                      [def.id]: e.target.value,
                    },
                    { shouldDirty: true, shouldValidate: true },
                  )
                }
              />
            ),
          )}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700}>
          Velocity — note &amp; reduced-capacity sprints
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mb: 1.5 }}
        >
          Explain a velocity dip here. The note below is shown under the
          Velocity Trend chart on the slide and in the PDF. You can also tick
          specific sprints whose velocity dipped due to reduced availability
          (e.g. planned leave) — ticked sprints are excluded from the average
          line and their reason is shown under the chart. Leave isn't tracked in
          the system, so this is your call.
        </Typography>
        <TextField
          size="small"
          fullWidth
          multiline
          minRows={2}
          maxRows={4}
          label="Note about velocity (shown on slide)"
          placeholder="e.g. 6.1 dipped — 1 dev (Sean) on planned leave, reduced capacity"
          error={!!errors.graphNotes?.["velocity-trend"]}
          helperText={errors.graphNotes?.["velocity-trend"]?.message}
          value={graphNotes["velocity-trend"] ?? ""}
          onChange={(e) =>
            setValue(
              "graphNotes",
              {
                ...graphNotes,
                "velocity-trend": e.target.value,
              },
              { shouldDirty: true, shouldValidate: true },
            )
          }
          sx={{ mb: 1.5 }}
        />
        <Divider sx={{ mb: 1.5 }} />
        {(() => {
          const projectsWithSprints = selectedProjectIds
            .map((pid) => ({ pid, proj: trendData?.[String(pid)] }))
            .filter(
              (x) =>
                x.proj &&
                Array.isArray(x.proj.sprints) &&
                x.proj.sprints.length > 0,
            );
          if (projectsWithSprints.length === 0) {
            return (
              <Typography variant="caption" color="text.secondary">
                No sprint trend data yet — use "Refresh data" to pull sprints
                first.
              </Typography>
            );
          }
          return (
            <Stack spacing={2}>
              {projectsWithSprints.map(({ pid, proj }) => (
                <Box key={pid}>
                  <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                    {proj.projectName || `Project ${pid}`}
                  </Typography>
                  <Stack spacing={0.5}>
                    {proj.sprints.map((s) => {
                      const key = `${pid}:${s.syncId}`;
                      const flag = capacityFlags[key];
                      return (
                        <Box
                          key={key}
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            flexWrap: "wrap",
                          }}
                        >
                          <FormControlLabel
                            sx={{ mr: 0, minWidth: 120 }}
                            control={
                              <Checkbox
                                size="small"
                                checked={!!flag}
                                onChange={(_e, checked) => {
                                  const next = { ...capacityFlags };
                                  if (checked) {
                                    next[key] = {
                                      projectId: Number(pid),
                                      syncId: s.syncId,
                                      sprintName: s.name,
                                      reason: capacityFlags[key]?.reason || "",
                                    };
                                  } else {
                                    delete next[key];
                                  }
                                  setValue("velocityCapacityFlags", next, {
                                    shouldDirty: true,
                                    shouldValidate: true,
                                  });
                                }}
                              />
                            }
                            label={
                              <Typography variant="body2">{s.name}</Typography>
                            }
                          />
                          {flag && (
                            <TextField
                              size="small"
                              sx={{ flex: 1, minWidth: 220 }}
                              placeholder="Reason (e.g. 1 dev on planned leave)"
                              error={
                                !!errors.velocityCapacityFlags?.[key]?.reason
                              }
                              helperText={
                                errors.velocityCapacityFlags?.[key]?.reason
                                  ?.message
                              }
                              value={flag.reason}
                              onChange={(e) =>
                                setValue(
                                  "velocityCapacityFlags",
                                  {
                                    ...capacityFlags,
                                    [key]: {
                                      ...capacityFlags[key],
                                      reason: e.target.value,
                                    },
                                  },
                                  { shouldDirty: true, shouldValidate: true },
                                )
                              }
                            />
                          )}
                        </Box>
                      );
                    })}
                  </Stack>
                </Box>
              ))}
            </Stack>
          );
        })()}
      </Paper>

      <CustomSectionsEditor
        sections={customSections}
        onChange={(sections) =>
          setValue("customSections", sections, {
            shouldDirty: true,
            shouldValidate: true,
          })
        }
        enableRowReorder
        getFieldError={(path) => {
          const message = getFieldState(
            path as FieldPath<PortfolioPresentationFormData>,
          ).error?.message;
          return typeof message === "string" ? message : undefined;
        }}
      />
    </Box>
  );
}
