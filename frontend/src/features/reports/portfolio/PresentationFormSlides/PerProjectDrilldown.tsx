import { Refresh } from "@mui/icons-material";
import {
  Box,
  Button,
  Typography,
  Paper,
  Chip,
  FormControl,
  FormHelperText,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Checkbox,
  TextField,
} from "@mui/material";
import { useFormContext, useWatch } from "react-hook-form";
import type { FieldPath, FieldPathValue } from "react-hook-form";
import { hasScopeData } from "../presentation/scope";
import type { PortfolioPresentationFormData } from "../types";

interface Props {
  actionType: (type: "refresh") => void;
  loadingPreview: boolean;
}

export function PerProjectDrilldown({ actionType, loadingPreview }: Props) {
  const { control, setValue, getFieldState, formState } =
    useFormContext<PortfolioPresentationFormData>();
  const { errors } = formState;
  const drilldown = useWatch({ control, name: "perProjectDrilldown" });
  const selectedProjectIds = useWatch({ control, name: "selectedProjectIds" });
  const setDrilldownField = <TFieldPath extends FieldPath<PortfolioPresentationFormData>,>(
    fieldPath: TFieldPath,
    value: FieldPathValue<PortfolioPresentationFormData, TFieldPath>,
  ) =>
    setValue(fieldPath, value, {
      shouldDirty: true,
      shouldValidate: true,
    });
  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          size="small"
          startIcon={<Refresh />}
          onClick={() => actionType("refresh")}
          disabled={loadingPreview}
        >
          {loadingPreview ? "Refreshing…" : "Refresh data from system"}
        </Button>
      </Box>
      {drilldown.length === 0 && (
        <Typography color="text.secondary">
          No per-project data. Go back to step 1 to pull a preview.
        </Typography>
      )}
      {drilldown.map((d, idx) => (
        <Paper
          key={d.projectId ?? idx}
          variant="outlined"
          sx={{ p: 2, borderLeft: "4px solid #37474f" }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              mb: 1,
              flexWrap: "wrap",
            }}
          >
            <Typography variant="h6" fontWeight={700}>
              {d.projectName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              · {d.sprintName}
            </Typography>
            {d.health && (
              <Chip
                size="small"
                label={`Auto: ${d.health}`}
                color={
                  d.health === "Red"
                    ? "error"
                    : d.health === "Amber"
                      ? "warning"
                      : "success"
                }
                variant="outlined"
                sx={{ fontWeight: 600 }}
              />
            )}
            <Box sx={{ flex: 1 }} />
            <FormControl
              size="small"
              sx={{ minWidth: 140 }}
              error={!!errors.perProjectDrilldown?.[idx]?.healthOverride}
            >
              <InputLabel>Health</InputLabel>
              <Select
                label="Health"
                value={d.healthOverride ?? ""}
                onChange={(e) => {
                  const value = e.target.value as
                    | ""
                    | "Green"
                    | "Amber"
                    | "Red";
                  const val = value === "" ? null : value;
                  setDrilldownField(
                    `perProjectDrilldown.${idx}.healthOverride` as FieldPath<PortfolioPresentationFormData>,
                    val,
                  );
                }}
              >
                <MenuItem value="">
                  <em>Auto ({d.health || "Green"})</em>
                </MenuItem>
                <MenuItem value="Green">Green</MenuItem>
                <MenuItem value="Amber">Amber</MenuItem>
                <MenuItem value="Red">Red</MenuItem>
              </Select>
              <FormHelperText>
                {errors.perProjectDrilldown?.[idx]?.healthOverride?.message}
              </FormHelperText>
            </FormControl>
            {/* "Show in presentation" hides a project from a multi-project
                          deck. Pointless for a single-project presentation (hiding the
                          only project yields an empty deck), so only show it when 2+
                          projects are included; isVisible stays at its default (true). */}
            {selectedProjectIds.length > 1 && (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={d.isVisible !== false}
                    onChange={(e) =>
                      setDrilldownField(
                        `perProjectDrilldown.${idx}.isVisible` as FieldPath<PortfolioPresentationFormData>,
                        e.target.checked,
                      )
                    }
                  />
                }
                label="Show in presentation"
              />
            )}
          </Box>
          <TextField
            label="Narrative"
            fullWidth
            multiline
            minRows={2}
            error={!!errors.perProjectDrilldown?.[idx]?.narrative}
            helperText={errors.perProjectDrilldown?.[idx]?.narrative?.message}
            value={d.narrative || ""}
            onChange={(e) =>
              setDrilldownField(
                `perProjectDrilldown.${idx}.narrative` as FieldPath<PortfolioPresentationFormData>,
                e.target.value,
              )
            }
          />
          {(() => {
            const isWsr = d.sprintMetrics?.dataSource === "wsr";
            // Perf presentations carry dual-scope data — the slide renders
            // metricsByScope[scope], so edits must target a per-scope OVERRIDE
            // layer (metricsOverrideByScope), NOT the shadowed base sprintMetrics.
            // Overrides feed only the high-level totals; charts/tables stay factual.
            if (!isWsr && hasScopeData(d)) {
              const overFields: Array<{ key: string; label: string }> = [
                { key: "capacity", label: "Capacity (SP)" },
                { key: "actual", label: "Delivered (SP)" },
                { key: "deliveredCount", label: "Delivered (tickets)" },
                { key: "spillovers", label: "Spillover (SP)" },
                { key: "spilloverCount", label: "Spillover (tickets)" },
                { key: "scopeAddedSP", label: "Scope Added (SP)" },
                {
                  key: "scopeAddedCount",
                  label: "Scope Added (tickets)",
                },
                { key: "removedSp", label: "Removed (SP)" },
                { key: "removedCount", label: "Removed (tickets)" },
                { key: "reEstimatedSp", label: "SP updated" },
                { key: "reopenedCount", label: "Reopens" },
                { key: "validBugs", label: "Bugs raised (QA)" },
              ];
              const scopes: Array<{
                key: "v2" | "overall";
                label: string;
              }> = [
                { key: "v2", label: "V2 Team" },
                { key: "overall", label: "Whole Team" },
              ];
              const setOverride = (
                scope: "v2" | "overall",
                key: string,
                raw: string,
              ) => {
                const scopeOverrides = {
                  ...(d.metricsOverrideByScope?.[scope] || {}),
                };
                if (raw === "") delete scopeOverrides[key];
                else scopeOverrides[key] = Number(raw);
                setDrilldownField(
                  `perProjectDrilldown.${idx}.metricsOverrideByScope.${scope}` as FieldPath<PortfolioPresentationFormData>,
                  Object.keys(scopeOverrides).length > 0
                    ? scopeOverrides
                    : undefined,
                );
              };
              const resetScope = (scope: "v2" | "overall") =>
                setDrilldownField(
                  `perProjectDrilldown.${idx}.metricsOverrideByScope.${scope}` as FieldPath<PortfolioPresentationFormData>,
                  undefined,
                );
              return (
                <>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: 1.5 }}
                  >
                    Adjust the headline totals shown on the slide, per scope.
                    Leave a field blank to keep the imported value (shown as
                    placeholder). Charts, the per-sprint breakdown, and team
                    tables always use the imported data.
                  </Typography>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "1.4fr 1fr 1fr",
                      gap: 1,
                      mt: 1,
                      alignItems: "center",
                    }}
                  >
                    <Box />
                    {scopes.map((s) => (
                      <Box
                        key={s.key}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 0.5,
                        }}
                      >
                        <Typography variant="caption" fontWeight={700}>
                          {s.label}
                        </Typography>
                        <Button
                          size="small"
                          onClick={() => resetScope(s.key)}
                          disabled={!d.metricsOverrideByScope?.[s.key]}
                        >
                          Reset
                        </Button>
                      </Box>
                    ))}
                    {overFields.map((f) => (
                      <Box key={f.key} sx={{ display: "contents" }}>
                        <Typography
                          variant="body2"
                          sx={{ color: "text.secondary" }}
                        >
                          {f.label}
                        </Typography>
                        {scopes.map((s) =>
                          (() => {
                            const fieldPath =
                              `perProjectDrilldown.${idx}.metricsOverrideByScope.${s.key}.${f.key}` as FieldPath<PortfolioPresentationFormData>;
                            const fieldError = getFieldState(
                              fieldPath,
                              formState,
                            ).error;
                            return (
                              <TextField
                                key={s.key}
                                size="small"
                                type="number"
                                error={!!fieldError}
                                helperText={
                                  typeof fieldError?.message === "string"
                                    ? fieldError.message
                                    : ""
                                }
                                value={
                                  d.metricsOverrideByScope?.[s.key]?.[f.key] ??
                                  ""
                                }
                                placeholder={String(
                                  d.metricsByScope?.[s.key]?.[f.key] ?? "—",
                                )}
                                onChange={(e) =>
                                  setOverride(s.key, f.key, e.target.value)
                                }
                              />
                            );
                          })(),
                        )}
                      </Box>
                    ))}
                  </Box>
                </>
              );
            }
            const fields: Array<{
              key: string;
              label: string;
            }> = isWsr
              ? [
                  { key: "ticketsCompleted", label: "Tickets Completed" },
                  {
                    key: "avgActiveTickets",
                    label: "Avg Active Tickets",
                  },
                  { key: "maxBlockedTickets", label: "Max Blocked" },
                  { key: "weeksCovered", label: "Weeks Covered" },
                ]
              : [
                  { key: "capacity", label: "Capacity" },
                  { key: "planned", label: "Planned" },
                  { key: "actual", label: "Actual" },
                  { key: "reworkPct", label: "Rework %" },
                  { key: "carryoverPct", label: "Carryover %" },
                ];
            return (
              <>
                {isWsr && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: 1.5 }}
                  >
                    Source: Weekly Status Reports (weekly ticket throughput —
                    not story points).
                  </Typography>
                )}
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: {
                      xs: "1fr",
                      md: `repeat(${fields.length}, 1fr)`,
                    },
                    gap: 1,
                    mt: 1,
                  }}
                >
                  {fields.map((f) => {
                    const fieldPath =
                      `perProjectDrilldown.${idx}.sprintMetrics.${f.key}` as FieldPath<PortfolioPresentationFormData>;
                    const fieldError = getFieldState(
                      fieldPath,
                      formState,
                    ).error;
                    return (
                      <TextField
                        key={f.key}
                        size="small"
                        type="number"
                        label={f.label}
                        error={!!fieldError}
                        helperText={
                          typeof fieldError?.message === "string"
                            ? fieldError.message
                            : ""
                        }
                        value={
                          (
                            d.sprintMetrics as unknown as
                              | Record<string, number>
                              | undefined
                          )?.[f.key] ?? ""
                        }
                        onChange={(e) =>
                          setDrilldownField(
                            fieldPath,
                            e.target.value === ""
                              ? undefined
                              : Number(e.target.value),
                          )
                        }
                      />
                    );
                  })}
                </Box>
              </>
            );
          })()}
        </Paper>
      ))}
    </Box>
  );
}
