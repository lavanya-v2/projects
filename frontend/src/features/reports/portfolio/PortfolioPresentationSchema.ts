import dayjs from "dayjs";
import z from "zod";

const sprintMetricsSchema = z.object({
  capacity: z
    .number()
    .min(1,"Select positive value")
    .max(100, "Select value under 100")
    .optional(),
  planned: z
    .number()
    .min(1, "Select positive value")
    .max(100, "Select value under 100")
    .optional(),
  actual: z
    .number()
    .min(1, "Select positive value")
    .max(100, "Select value under 100")
    .optional(),
  scopeChange: z.number().optional(),
  reworkPct: z
    .number()
    .min(1, "Select positive value")
    .max(100, "Select value under 100")
    .optional(),
  carryoverPct: z
    .number()
    .min(1, "Select positive value")
    .max(100, "Select value under 100")
    .optional(),
  v2Only: z.boolean().optional(),
  dataSource: z.string(),
});

const qualityMetricsSchema = z.object({
  storyPoints: z.number().optional(),
  validBugs: z.number().optional(),
  bugDensityPct: z.number().optional(),
  bugsProd: z.number().optional(),
  leakageRatePct: z.number().optional(),
  leakageBugsRaised: z.number().optional(),
  reopenedCount: z.number().optional(),
  deliveredCount: z.number().optional(),
  reopenRatePct: z.number().optional(),
  invalidReopenCount: z.number().optional(),
  invalidBugCount: z.number().optional(),
  prodBugsWorked: z.number().optional(),
  prodBugsWorkedSp: z.number().optional(),
  prodBugsWorkedInvalid: z.number().optional(),
  prodBugsWorkedInvalidSp: z.number().optional(),
  uatReopenedCount: z.number().optional(),
  prodBugKeys: z.array(z.string()).optional(),
  prodBugsWorkedKeys: z.array(z.string()).optional(),
  prodBugsWorkedInvalidKeys: z.array(z.string()).optional(),
  uatReopenedKeys: z.array(z.string()).optional(),
  uiBugs: z.number().optional(),
  apiBugs: z.number().optional(),
  cssBugs: z.number().optional(),
  dbBugs: z.number().optional(),
  otherBugs: z.number().optional(),
});

const developerVelocitySchema = z.object({
  maxSp: z.number(),
  sprints: z.array(
    z.object({
      syncId: z.number(),
      endDate: z.string(),
      startDate: z.string(),
      sprintName: z.string(),
    }),
  ),
  developers: z.array(
    z.object({
      name: z.string(),
      jiraLoginId: z.string(),
      spDeliveredBySync: z.record(z.string(), z.number()),
      spCarriedOverBySync: z.record(z.string(), z.number()),
    }),
  ),
  perRowScale: z.boolean(),
});

const scopedMetricsSchema = z.object({
  actual: z.number().optional(),
  planned: z.number().optional(),
  capacity: z.number().optional(),
  perSprint: z
    .array(
      z.object({
        actual: z.number().optional(),
        syncId: z.number(),
        planned: z.number().optional(),
        bugCount: z.number().optional(),
        removedSp: z.number().optional(),
        deliveredSP: z.number().optional(),
        removedCount: z.number().optional(),
        reopenRatePct: z.number().optional(),
        reopenedCount: z.number().optional(),
        deliveredCount: z.number().optional(),
      }),
    )
    .optional(),
  removedSp: z.number().optional(),
  validBugs: z.number().optional(),
  metricKind: z.string().optional(),
  removedPct: z.number().optional(),
  spillovers: z.number().optional(),
  storyPoints: z.number().optional(),
  removedCount: z.number().optional(),
  scopeAddedSP: z.number().optional(),
  spilloverPct: z.number().optional(),
  bugDensityPct: z.number().optional(),
  reEstimatedSp: z.number().optional(),
  reopenRatePct: z.number().optional(),
  reopenedCount: z.number().optional(),
  scopeCreepPct: z.number().optional(),
  deliveredCount: z.number().optional(),
  spilloverCount: z.number().optional(),
  productivityPct: z.number().optional(),
  scopeAddedCount: z.number().optional(),
});

const isWithinReportingDateRange = (value: string) => {
  const date = dayjs(value);
  const today = dayjs().startOf("day");
  const earliestDate = today.subtract(12, "month");

  return (
    date.isValid() &&
    !date.isBefore(earliestDate, "day") &&
    date.isBefore(today, "day")
  );
};

const dateRangeFieldsSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
});

export const portfolioPresentationSchema = z.object({
    title: z.string().trim().min(1, "Title is required"),
    meetingDate: z.string().refine(
      (value) => {
        if (!value) return true;
        const today = dayjs();
        const dueDate = dayjs(value);
        return dueDate.isBefore(today);
      },
      {
        message: "Meeting date cannot be future date",
      },
    ),
    startDate: z
      .string()
      .min(1, "Start date is required")
      .refine((value) => !value || isWithinReportingDateRange(value), {
        message: "Start date must be within the past 12 months",
      }),
    endDate: z
      .string()
      .min(1, "End date is required")
      .refine((value) => !value || isWithinReportingDateRange(value), {
        message: "End date must be within the past 12 months",
      }),
    health: z.enum(["Green", "Amber", "Red"]),
    dateSelectionMode: z.enum(["range", "sprint"]),
    selectedSprintId: z.number().nullable(),
    scopeMode: z.enum(["account", "program"]),
    programId: z.number().nullable(),
    selectedProjectIds: z
      .array(z.number())
      .min(1, "Select at least one project"),
    selectedSprintMap: z.record(z.string(), z.number().nullable()),
    keyHighlights: z.object({
      summary: z.string(),
      achievements: z.array(z.string()),
      blockers: z.array(z.string()),
      capacityNotes: z.array(z.string()),
    }),
    risks: z.array(
      z.object({
        projectId: z.number().nullable().optional(),
        projectName: z.string(),
        title: z.string(),
        description: z.string().optional(),
        priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
        status: z.enum(["NEW", "WORK_IN_PROGRESS", "STALE", "DONE"]),
        source: z.enum(["CLIENT", "INTERNAL"]).optional(),
      }),
    ),
    actionItemsSnapshot: z.array(
      z.object({
        id: z.number().optional(),
        projectId: z.number().nullable().optional(),
        projectName: z.string(),
        title: z.string(),
        owner: z.string(),
        status: z.enum([
          "Open",
          "In-Progress",
          "Closed",
          "Discarded"
        ]),
        dueDate: z.string().nullable().optional(),
        category: z.enum([
          "Task",
          "Follow-up",
          "Decision required",
          "Issue",
          "Risk & mitigation",
          "Dependency",
        ]),
        source: z.enum(["project", "program", "account"]),
      }),
    ),
    techRecommendations: z.array(z.string()),
    discussionPoints: z.array(z.string()),
    perProjectDrilldown: z.array(
      z.object({
        projectId: z.number().nullable(),
        projectName: z.string(),
        health: z.enum(["Green", "Amber", "Red"]).optional(),
        healthOverride: z.enum(["Green", "Amber", "Red"]).nullable().optional(),
        narrative: z.string(),
        sprintName: z.string(),
        sprintMetrics: sprintMetricsSchema,
        qualityMetrics: qualityMetricsSchema,
        teamMembers: z.array(
          z.object({
            name: z.string(),
            role: z.string(),
            storyPoints: z.number().optional(),
            execution: z.number().optional(),
            quality: z.number().optional(),
            overallRating: z.number().optional(),
          }),
        ),
        isVisible: z.boolean(),
        metricsOverrideByScope: z
          .object({
            v2: z.record(z.string(), z.number()).optional(),
            overall: z.record(z.string(), z.number()).optional(),
          })
          .optional(),
        metricsByScope: z
          .object({
            v2: scopedMetricsSchema.optional(),
            overall: scopedMetricsSchema.optional(),
          })
          .optional(),
        developerVelocityByScope: z
          .object({
            v2: developerVelocitySchema.optional(),
            overall: developerVelocitySchema.optional(),
          })
          .optional(),
      }),
    ),
    trendData: z.record(
      z.string(),
      z.object({
        projectName: z.string(),
        sprints: z.array(
          z.object({
            syncId: z.number(),
            name: z.string(),
            startDate: z.string().optional(),
            endDate: z.string().optional(),
            metrics: sprintMetricsSchema,
            qualityMetrics: qualityMetricsSchema,
          }),
        ),
        jiraBaseUrl: z.string().nullable().optional(),
      }),
    ),
    hiddenCharts: z.record(z.string(), z.boolean()),
    graphNotes: z.record(z.string(), z.string()),
    velocityCapacityFlags: z.record(
      z.string(),
      z.object({
        projectId: z.number(),
        syncId: z.number(),
        sprintName: z.string(),
        reason: z.string(),
      }),
    ),
    teamCapacityRows: z.array(
      z.object({
        name: z.string(),
        jiraLoginId: z.string().nullable().optional(),
        sprint: z.string(),
        plannedLeaves: z.number().nullable(),
        unplannedLeaves: z.number().nullable(),
        storyPointsDelivered: z.number().nullable(),
        carryOverSp: z.number().nullable(),
        workingDays: z.number().nullable().optional(),
      }),
    ),
    customSections: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        displayMode: z.enum(["table", "chart"]),
        columns: z.array(
          z.object({
            key: z.string(),
            label: z.string(),
            type: z.enum(["text", "number", "percentage", "date"]),
          }),
        ),
        rows: z.array(
          z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
        ),
        chart: z
          .object({
            type: z.enum(["bar", "stacked-bar", "line"]),
            categoryColumn: z.string(),
            valueColumns: z.array(z.string()),
          })
          .optional(),
      }),
    ),
    milestones: z.array(
      z.object({
        milestone: z.string(),
        status: z.string(),
        percentComplete: z.number(),
        eta: z.string(),
        projectName: z.string().optional(),
      }),
    ),
  })
  .refine(
    ({ startDate, endDate }) => {
      const start = dayjs(startDate);
      const end = dayjs(endDate);
      return (
        !start.isValid() ||
        !end.isValid() ||
        !end.isBefore(start, "day")
      );
    },
    {
      path: ["endDate"],
      message: "End date cannot be before start date",
      when: ({ value }) => dateRangeFieldsSchema.safeParse(value).success,
    },
  );
