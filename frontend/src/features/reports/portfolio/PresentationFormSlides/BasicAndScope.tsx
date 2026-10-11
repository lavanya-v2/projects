import {
  Box,
  TextField,
  FormControl,
  FormHelperText,
  InputLabel,
  Select,
  MenuItem,
  Paper,
  Typography,
  RadioGroup,
  FormControlLabel,
  Radio,
  Chip,
  Button,
  Checkbox,
  Alert,
  CircularProgress,
} from "@mui/material";
import { DatePicker } from "@mui/x-date-pickers";
import dayjs from "dayjs";
import { useEffect, useMemo } from "react";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { useProgByAccWithoutPagination } from "../../../programs/hooks";
import { usePerfSyncHistory } from "../../../team-performance/hooks";
import { useProjects } from "../../../auth/hooks";
import type { Project } from "../../../../types";
import { usePreviewPortfolioPayload } from "../hooks";
import type {
  PortfolioPresentation,
  PortfolioPresentationFormData,
} from "../types";

interface Props {
  accountId: number;
  existing?: PortfolioPresentation | null;
  isActiveProject: (p: Project) => boolean;
  visibleProjects: Project[];
  setDataStale: (stale: boolean) => void;
}
export function BasicAndScope({
  accountId,
  isActiveProject,
  visibleProjects,
  setDataStale,
}: Props) {
  const {
    control,
    getValues,
    setValue,
    trigger,
    formState: { errors },
  } = useFormContext<PortfolioPresentationFormData>();
  const formValues = useWatch({ control });
  const {
    dateSelectionMode: dateMode,
    selectedSprintId,
    selectedProjectIds,
    scopeMode,
  } = formValues;
  const pickedProgramId = formValues.programId;
  const singleProjectId =
    selectedProjectIds?.length === 1 ? selectedProjectIds[0] : null;
  // Programs for this account; empty programs filtered server-side
  const programsQuery = useProgByAccWithoutPagination(accountId || null, true);
  const programs = programsQuery.data ?? [];

  const previewMutation = usePreviewPortfolioPayload();
  const loadingPreview = previewMutation.isPending;

  const projectsQuery = useProjects(accountId || undefined);
  const projects: Project[] = useMemo(
    () => (projectsQuery.data ?? []) as Project[],
    [projectsQuery.data],
  );

  // Projects rendered in the checkbox grid — filter by scope mode.
  // Phase 1.6: Delivery Presentation aggregates from Jira flows only; Excel projects hidden.
  // Sprint-based window selection is offered only when exactly ONE project is in
  // scope. Source the sprint list from the project's already-synced performances
  // data (local DB, instant) rather than a live Jira call — these are exactly the
  // sprints that produce presentation data, and it avoids a multi-second wait.
  const perfSyncQuery = usePerfSyncHistory(singleProjectId ?? 0);
  const completedSprints = (perfSyncQuery.data ?? [])
    .filter(
      (s) =>
        s.syncType === "sprint" &&
        s.syncStatus === "done" &&
        s.jiraSprintId != null &&
        s.startDate &&
        s.endDate &&
        String(s.endDate).slice(0, 10) < dayjs().format("YYYY-MM-DD"),
    ) // completed only
    .slice(0, 5) // rows come start_date DESC
    .map((s) => ({
      id: s.jiraSprintId as number,
      name: s.sprintName as string,
      startDate: s.startDate as string,
      endDate: s.endDate as string,
    }));
  const sprintModeAvailable =
    singleProjectId !== null && completedSprints.length > 0;

  // Sprint mode is single-project only. If the scope grows to 2+ projects (or
  // drops to none), revert to date range and drop any stale sprint reference.
  useEffect(() => {
    if (singleProjectId === null && dateMode === "sprint") {
      setValue("dateSelectionMode", "range", { shouldDirty: true });
      setValue("selectedSprintId", null, { shouldDirty: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [singleProjectId]);

  // Auto-sync the selection to scope changes lives in the user-interaction
  // handlers below (handleScopeModeChange, handlePickProgram) instead of a
  // useEffect, so the initial mount cannot overwrite a persisted selection.
  const handleScopeModeChange = (mode: "account" | "program") => {
    setValue("scopeMode", mode, { shouldDirty: true });
    if (mode === "account") {
      setValue("programId", null, { shouldDirty: true });
      setValue(
        "selectedProjectIds",
        projects
          .filter((p) => !p.isSharedTeam && isActiveProject(p))
          .map((p) => p.id),
        { shouldDirty: true },
      );
    } else {
      // Switching INTO program mode - clear selection until a program is picked
      // (or sync immediately if a program is already selected from a prior visit).
      if (pickedProgramId == null) {
        setValue("selectedProjectIds", [], { shouldDirty: true });
      } else {
        setValue(
          "selectedProjectIds",
          projects
            .filter(
              (p) =>
                !p.isSharedTeam &&
                isActiveProject(p) &&
                p.programId === pickedProgramId,
            )
            .map((p) => p.id),
          { shouldDirty: true },
        );
      }
    }
  };

  const handlePickProgram = (programId: number | null) => {
    setValue("programId", programId, { shouldDirty: true });
    if (programId == null) {
      setValue("selectedProjectIds", [], { shouldDirty: true });
    } else {
      setValue(
        "selectedProjectIds",
        projects
          .filter(
            (p) =>
              !p.isSharedTeam &&
              isActiveProject(p) &&
              p.programId === programId,
          )
          .map((p) => p.id),
        { shouldDirty: true },
      );
    }
  };

  const toggleProject = (id: number) => {
    const ids = getValues("selectedProjectIds");
    setValue(
      "selectedProjectIds",
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
      { shouldDirty: true },
    );
  };

  const selectAllVisible = () =>
    setValue(
      "selectedProjectIds",
      visibleProjects.map((p) => p.id),
      { shouldDirty: true },
    );
  const unselectAllVisible = () =>
    setValue(
      "selectedProjectIds",
      getValues("selectedProjectIds").filter(
        (id) => !visibleProjects.some((p) => p.id === id),
      ),
      { shouldDirty: true },
    );
  const visibleSelectedCount = visibleProjects.filter((p) =>
    selectedProjectIds?.includes(p.id),
  ).length;

  // Picking a sprint drives the reporting window from its Jira start/end dates.
  // The dropdown is fed RAW Jira ISO timestamps (with offsets), not the DATEONLY
  // DB rows. Truncate lexically at the 'T' (split('T')[0]) instead of reinterpreting
  // the instant via dayjs — this matches exactly how the sync path stores sprint
  // dates (performanceSyncService: (sprintMeta.startDate ?? '').split('T')[0]), so
  // the window equals the PerfSprintSync DATEONLY rows and pickSprintsInWindow
  // returns exactly the chosen sprint (no timezone day-drift). Marks the window
  // dirty so a refresh is forced.
  const onSprintPick = (sprintId: number) => {
    const sprint = completedSprints.find((s) => s.id === sprintId);
    if (!sprint) return;
    setValue("selectedSprintId", sprint.id, { shouldDirty: true });
    if (sprint.startDate)
      setValue("startDate", sprint.startDate.split("T")[0], {
        shouldDirty: true,
      });
    if (sprint.endDate)
      setValue("endDate", sprint.endDate.split("T")[0], { shouldDirty: true });
    setDataStale(true);
  };

  const onDateModeChange = (next: "range" | "sprint") => {
    if (next === dateMode) return;
    setValue("dateSelectionMode", next, { shouldDirty: true });
    setDataStale(true);
    if (next === "range") {
      setValue("selectedSprintId", null, { shouldDirty: true });
    } else if (
      selectedSprintId &&
      completedSprints.some((s) => s.id === selectedSprintId)
    ) {
      onSprintPick(selectedSprintId);
    }
  };

  const formatDate = (date: string | null) => {
    return date ? dayjs(date) : null;
  };

  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Controller
        name="title"
        control={control}
        render={({ field }) => (
          <TextField
            {...field}
            label="Title"
            error={!!errors.title}
            helperText={errors.title?.message}
            fullWidth
            required
          />
        )}
      />

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          gap: 2,
        }}
      >
        <Controller
          name="meetingDate"
          control={control}
          render={({ field }) => (
            <DatePicker
              label="Meeting Date"
              value={formatDate(field.value)}
              onChange={(date) =>
                field.onChange(date?.format("YYYY-MM-DD") ?? "")
              }
              slotProps={{
                textField: {
                  error: !!errors.meetingDate,
                  helperText: errors.meetingDate?.message,
                },
              }}
              minDate={dayjs().subtract(12, "month")}
              maxDate={dayjs().subtract(1, "day")}
              sx={{ minWidth: 160 }}
            />
          )}
        />
        <Controller
          name="health"
          control={control}
          render={({ field }) => (
            <FormControl error={!!errors.health}>
              <InputLabel>Health</InputLabel>
              <Select {...field} label="Health">
                <MenuItem value="Green">🟢 Green</MenuItem>
                <MenuItem value="Amber">🟡 Amber</MenuItem>
                <MenuItem value="Red">🔴 Red</MenuItem>
              </Select>
              <FormHelperText>{errors.health?.message}</FormHelperText>
            </FormControl>
          )}
        />
      </Box>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Projects in scope
        </Typography>

        {/* Phase 9: scope-mode toggle */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            flexWrap: "wrap",
            mb: 1,
          }}
        >
          <Controller
            name="scopeMode"
            control={control}
            render={({ field }) => (
              <RadioGroup
                row
                {...field}
                onChange={(e) =>
                  handleScopeModeChange(e.target.value as "account" | "program")
                }
              >
                <FormControlLabel
                  value="account"
                  control={<Radio size="small" />}
                  label="By Project"
                />
                <FormControlLabel
                  value="program"
                  control={<Radio size="small" />}
                  label="By Program"
                  disabled={programs.length === 0}
                />
              </RadioGroup>
            )}
          />
          {scopeMode === "program" && (
            <FormControl
              size="small"
              sx={{ minWidth: 240 }}
              error={!!errors.programId}
            >
              <InputLabel>Program</InputLabel>
              <Controller
                name="programId"
                control={control}
                render={({ field }) => (
                  <Select
                    sx={{ width: 250 }}
                    label="Program"
                    value={field.value === null ? "" : String(field.value)}
                    onChange={(e) =>
                      handlePickProgram(
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                    MenuProps={{
                      PaperProps: {
                        sx: {
                          maxWidth: 250,
                          maxHeight: 260,
                        },
                      },
                    }}
                  >
                    <MenuItem value="">
                      <em>Select a program…</em>
                    </MenuItem>
                    {programs.map((pg) => (
                      <MenuItem key={pg.id} value={String(pg.id)}>
                        {pg.name}
                      </MenuItem>
                    ))}
                  </Select>
                )}
              />
              <FormHelperText>{errors.programId?.message}</FormHelperText>
            </FormControl>
          )}
          {scopeMode === "program" && programs.length === 0 && (
            <Typography variant="caption" color="text.secondary">
              No programs configured for this account.
            </Typography>
          )}
        </Box>
        {errors.selectedProjectIds?.message && (
          <FormHelperText error>
            {errors.selectedProjectIds.message}
          </FormHelperText>
        )}

        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mb: 1 }}
        >
          {scopeMode === "program"
            ? "All projects under the selected program will be included in the presentation."
            : "All account projects are included by default. Uncheck any you want to leave out."}
        </Typography>

        {scopeMode === "program" ? (
          // Program mode — read-only project list. Selection is whole-program; no per-project toggling.
          pickedProgramId == null ? (
            <Typography color="text.secondary" variant="body2">
              Pick a program to see its projects.
            </Typography>
          ) : visibleProjects.length === 0 ? (
            <Typography color="text.secondary" variant="body2">
              This program has no assigned projects.
            </Typography>
          ) : (
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mb: 0.5 }}
              >
                {visibleProjects.length} project
                {visibleProjects.length === 1 ? "" : "s"} included:
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                {visibleProjects.map((p) => (
                  <Chip
                    key={p.id}
                    label={
                      <Box
                        component="span"
                        sx={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 0.5,
                        }}
                      >
                        {p.name}
                        {p.isKanbanProject && (
                          <Chip
                            label="Kanban"
                            component="span"
                            size="small"
                            sx={{ fontSize: 10, height: 16 }}
                          />
                        )}
                      </Box>
                    }
                    variant="outlined"
                  />
                ))}
              </Box>
            </Box>
          )
        ) : (
          // Account mode — checkbox grid with select-all / unselect-all toolbar.
          <>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                mb: 1,
              }}
            >
              <Chip
                size="small"
                label={`${visibleSelectedCount} of ${visibleProjects.length} selected`}
              />
              <Box sx={{ flexGrow: 1 }} />
              <Button
                size="small"
                onClick={selectAllVisible}
                disabled={
                  visibleProjects.length === 0 ||
                  visibleSelectedCount === visibleProjects.length
                }
              >
                Select all
              </Button>
              <Button
                size="small"
                onClick={unselectAllVisible}
                disabled={visibleSelectedCount === 0}
              >
                Unselect all
              </Button>
            </Box>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" },
                gap: 1,
              }}
            >
              {visibleProjects.map((p) => (
                <FormControlLabel
                  key={p.id}
                  control={
                    <Checkbox
                      checked={selectedProjectIds?.includes(p.id)}
                      onChange={() => {
                        toggleProject(Number(p.id));
                      }}
                    />
                  }
                  label={
                    <Typography component="span">
                      {p.name}{" "}
                      {p.isKanbanProject && (
                        <Chip
                          label="Kanban"
                          component="span"
                          size="small"
                          sx={{ fontSize: 10, height: 18, ml: 0.5 }}
                        />
                      )}
                    </Typography>
                  }
                />
              ))}
              {visibleProjects.length === 0 && (
                <Typography color="text.secondary">
                  No projects available.
                </Typography>
              )}
            </Box>
          </>
        )}
      </Paper>

      {/* Reporting window — chosen AFTER scope. When exactly one project is
            in scope the user may pick a completed sprint (auto-fills the
            dates); otherwise it's a plain date range. */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Reporting window
        </Typography>

        {sprintModeAvailable && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              flexWrap: "wrap",
              mb: 1,
            }}
          >
            <Controller
              name="dateSelectionMode"
              control={control}
              render={({ field }) => (
                <RadioGroup
                  row
                  {...field}
                  onChange={(e) =>
                    onDateModeChange(e.target.value as "range" | "sprint")
                  }
                >
                  <FormControlLabel
                    value="range"
                    control={<Radio size="small" />}
                    label="Date range"
                  />
                  <FormControlLabel
                    value="sprint"
                    control={<Radio size="small" />}
                    label="By sprint"
                  />
                </RadioGroup>
              )}
            />
            {dateMode === "sprint" && (
              <FormControl
                size="small"
                sx={{ minWidth: 320 }}
                error={!!errors.selectedSprintId}
              >
                <InputLabel>Sprint (last 5 completed)</InputLabel>
                <Controller
                  name="selectedSprintId"
                  control={control}
                  render={({ field }) => (
                    <Select
                      label="Sprint (last 5 completed)"
                      value={field.value === null ? "" : String(field.value)}
                      onChange={(e) => onSprintPick(Number(e.target.value))}
                    >
                      <MenuItem value="">
                        <em>Select a sprint…</em>
                      </MenuItem>
                      {completedSprints.map((s) => (
                        <MenuItem key={s.id} value={String(s.id)}>
                          {s.name} (
                          {dayjs(s.startDate.split("T")[0]).format("DD MMM")} –{" "}
                          {dayjs(s.endDate.split("T")[0]).format("DD MMM YYYY")}
                          )
                        </MenuItem>
                      ))}
                    </Select>
                  )}
                />
                <FormHelperText>
                  {errors.selectedSprintId?.message}
                </FormHelperText>
              </FormControl>
            )}
          </Box>
        )}

        {/* Mode-aware guidance so the user knows how each choice shapes the data. */}
        {sprintModeAvailable && (
          <Alert severity="info" variant="outlined" sx={{ mb: 1, py: 0.25 }}>
            {dateMode === "sprint"
              ? "By sprint: the presentation reflects exactly the selected sprint (matched to Jira, not by dates — no risk of pulling an adjacent sprint), and the trend graphs show this sprint alongside the ones before it. Start/End are set from the sprint and locked."
              : 'Date range: the presentation aggregates all completed sprints within the dates (any in-progress sprint is shown separately), and the trend graphs show the latest 5 completed sprints. Switch to "By sprint" to report on one specific sprint.'}
          </Alert>
        )}

        {singleProjectId !== null && perfSyncQuery.isLoading && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <CircularProgress size={14} />
            <Typography variant="caption" color="text.secondary">
              Loading sprints…
            </Typography>
          </Box>
        )}

        {singleProjectId !== null &&
          !sprintModeAvailable &&
          !perfSyncQuery.isLoading && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mb: 1 }}
            >
              No completed sprints available for this project — use a date
              range.
            </Typography>
          )}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
            gap: 2,
          }}
        >
          <Controller
            name="startDate"
            control={control}
            render={({ field }) => (
              <DatePicker
                label="Start Date*"
                value={formatDate(field.value)}
                onChange={(date) => {
                  field.onChange(date?.format("YYYY-MM-DD") ?? "")
                  void trigger(["startDate", "endDate"]);
                }}
                slotProps={{
                  textField: {
                    error: !!errors.startDate,
                    helperText: errors.startDate?.message,
                  },
                }}
                minDate={dayjs().subtract(12, "month")}
                maxDate={dayjs().subtract(1, "day")}
                sx={{ minWidth: 160 }}
              />
            )}
          />
          <Controller
            name="endDate"
            control={control}
            render={({ field }) => (
              <DatePicker
                label="End Date*"
                value={formatDate(field.value)}
                onChange={(date) => {
                  field.onChange(date?.format("YYYY-MM-DD") ?? "")
                  void trigger(["startDate", "endDate"]);
                }}
                slotProps={{
                  textField: {
                    error: !!errors.endDate,
                    helperText: errors.endDate?.message,
                  },
                }}
                minDate={dayjs(formValues.startDate)}
                maxDate={dayjs()}
                sx={{ minWidth: 160 }}
              />
            )}
          />
        </Box>
      </Paper>

      {loadingPreview && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <CircularProgress size={18} />
          <Typography variant="caption" color="text.secondary">
            Pulling sprint metrics, risks, and action items…
          </Typography>
        </Box>
      )}
    </Box>
  );
}
