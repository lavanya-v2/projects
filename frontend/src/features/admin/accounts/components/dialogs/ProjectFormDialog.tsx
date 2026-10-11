/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Box, FormControl, FormLabel, FormHelperText, InputLabel, Select, MenuItem,
  Divider, Typography, Switch, FormControlLabel, RadioGroup, Radio,
  Accordion, AccordionSummary, AccordionDetails, CircularProgress,
  ToggleButton, ToggleButtonGroup, Alert, Autocomplete, Chip,
} from '@mui/material';
import { CheckCircle, CloudUpload, Error as ErrorIcon, ExpandMore } from '@mui/icons-material';
import {
  useAdminCreateProject,
  useAdminUpdateProject,
  useProjectMapping,
  useProjectMappingDetails,
  useSuggestMapping,
  useTestJira,
} from '../../../projects/hooks';
import type { MappingDetails } from '../../../projects/hooks';
import type { Account } from '../../types';
import {
  LANE_DEFAULTS,
  LANE_LABELS,
  LANE_KEYS,
  OWNER_ROLE_KEYS,
  OWNER_ROLE_LABELS,
  OWNER_ROLE_DEFAULTS,
  OWNER_ROLE_HELP,
  emptyLaneConfig,
  laneConfigFromProject,
  laneConfigToPayload,
  isCustomLaneConfig,
} from '../../laneConfig';
import type { LaneFormConfig } from '../../laneConfig';
import { client } from '../../../../../api/client';
// Sample headers are read server-side now, by the same parser that reads every upload, so the
// browser no longer parses workbooks here.
import { closeOnEscapeOnly, DialogCloseButton } from '../../../../../shared/components/dialogHelpers';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

type DataSourceType = 'jira' | 'azure_devops' | 'excel' | 'custom-excel';

/** A person-type Jira field on the board, with how often it is filled on the current sprint. */
interface PersonField {
  id: string;
  name: string;
  coveragePct: number | null;
  /** False for fields describing who raised or designed the work (Reporter, Creator, PM…). */
  likelyDelivery: boolean;
}

interface ProjectForm {
  name: string;
  code: string;
  accountId: number | '';
  dataSourceType: DataSourceType;
  reportingFrequency: 'daily' | 'weekly' | 'sprint';
  jiraBoardId: string | '';
  jiraName: string;
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraApiToken: string;
  azureOrgUrl: string;
  azureProject: string;
  azureTeam: string;
  azurePat: string;
  azureBoardId: string;
  isSharedTeam: boolean;
  isKanbanProject: boolean;
  // Meaningless for Kanban (no sprintBurndown concept there) -- only shown/editable
  // when isKanbanProject is false. 'on_the_go' = team commits to a total sprint SP
  // and picks up tickets on the go, no stable per-person/per-subteam scope from
  // day 1 (e.g. Thrive's Team Delta); 'planned' = fixed individual SP target
  // (e.g. CCM). Defaults to 'planned' so existing projects are unaffected.
  sprintAssignmentModel: 'planned' | 'on_the_go';
  piiRedactionEnabled: boolean;
  kanbanDoneStatuses: string;
  kanbanCycleDays: number | '';
  kanbanCycleStrideDays: number | '';
  kanbanCycleAnchorDate: string;
  kanbanAutoSync: boolean;
  estimationType: 'story_points' | 'hours';
  hoursSource: 'time_tracking' | 'custom_field';
  hoursFieldName: string;
  defaultDailyCapacityHours: number | '';
  isActive: boolean;
  inactiveSince: string | null;
  laneConfig: LaneFormConfig;
  devAssistantAiTool: 'claude' | 'copilot' | 'openai' | 'cursor' | 'none';
}

const emptyForm = (accountId: number | '' = ''): ProjectForm => ({
  name: '',
  code: '',
  accountId: accountId,
  dataSourceType: 'jira',
  reportingFrequency: 'daily',
  jiraBoardId: '',
  jiraName: '',
  jiraBaseUrl: '',
  jiraEmail: '',
  jiraApiToken: '',
  azureOrgUrl: '',
  azureProject: '',
  azureTeam: '',
  azurePat: '',
  azureBoardId: '',
  isSharedTeam: false,
  isKanbanProject: false,
  sprintAssignmentModel: 'planned',
  piiRedactionEnabled: true,
  kanbanDoneStatuses: '',
  kanbanCycleDays: '',
  kanbanCycleStrideDays: '',
  kanbanCycleAnchorDate: '',
  kanbanAutoSync: false,
  estimationType: 'story_points',
  hoursSource: 'time_tracking',
  hoursFieldName: '',
  defaultDailyCapacityHours: '',
  isActive: true,
  inactiveSince: null,
  laneConfig: emptyLaneConfig(),
  devAssistantAiTool: 'none',
});

const formFromProject = (p: any): ProjectForm => ({
  name: p.name,
  code: p.code,
  accountId: p.accountId,
  dataSourceType: (p.dataSourceType as DataSourceType) || 'jira',
  reportingFrequency: (p.reportingFrequency as 'daily' | 'weekly' | 'sprint') || 'daily',
  jiraBoardId: p.jiraBoardId || '',
  jiraName: p.jiraName || '',
  jiraBaseUrl: p.jiraBaseUrl || '',
  jiraEmail: p.jiraEmail || '',
  jiraApiToken: p.jiraApiToken || '',
  azureOrgUrl: p.azureOrgUrl || '',
  azureProject: p.azureProject || '',
  azureTeam: p.azureTeam || '',
  azurePat: p.azurePat || '',
  azureBoardId: p.azureBoardId || '',
  isSharedTeam: !!p.isSharedTeam,
  isKanbanProject: !!p.isKanbanProject,
  sprintAssignmentModel: p.sprintAssignmentModel === 'on_the_go' ? 'on_the_go' : 'planned',
  // !== false, not !!: a project row fetched before the API change would
  // otherwise read as opted-out of redaction.
  piiRedactionEnabled: p.piiRedactionEnabled !== false,
  kanbanDoneStatuses: Array.isArray(p.kanbanDoneStatuses)
    ? p.kanbanDoneStatuses.join(', ')
    : p.kanbanDoneStatuses || '',
  kanbanCycleDays: p.kanbanCycleDays ?? '',
  kanbanCycleStrideDays: p.kanbanCycleStrideDays ?? '',
  kanbanCycleAnchorDate: p.kanbanCycleAnchorDate || '',
  kanbanAutoSync: !!p.kanbanAutoSync,
  estimationType: p.estimationType === 'hours' ? 'hours' : 'story_points',
  hoursSource: p.hoursSource === 'custom_field' ? 'custom_field' : 'time_tracking',
  hoursFieldName: p.hoursFieldName || '',
  defaultDailyCapacityHours: p.defaultDailyCapacityHours != null ? Number(p.defaultDailyCapacityHours) : '',
  isActive: p.isActive !== false,
  inactiveSince: p.inactiveSince ?? null,
  laneConfig: laneConfigFromProject(p.jiraLaneConfig),
  devAssistantAiTool: (['claude', 'copilot', 'openai', 'cursor', 'none'] as const).includes(p.devAssistantAiTool)
    ? p.devAssistantAiTool
    : 'none',
});

interface JiraTestResult {
  ok: boolean;
  label: string;
}

interface ProjectFormDialogProps {
  open: boolean;
  editing: any | null;
  accounts: Account[];
  defaultAccountId?: number | '';
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
  setSnackbar: Dispatch<SetStateAction<{ msg: string, severity: 'success' | 'error' } | null>>
}

/** Create or edit a project. Includes Jira connection test + lane config. */
export const ProjectFormDialog = ({
  open,
  editing,
  accounts,
  defaultAccountId = '',
  onClose,
  onSuccess,
  onError,
  setSnackbar,
}: ProjectFormDialogProps) => {
  const createProject = useAdminCreateProject();
  const updateProject = useAdminUpdateProject();
  const saveProjectMapping = useProjectMapping();
  const fetchMappingDetails = useProjectMappingDetails();
  const suggestMapping = useSuggestMapping();
  const testJira = useTestJira();

  const initialFormRef = useRef<ProjectForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  /** Person-type Jira fields on this project's board, with how often each is populated. */
  const [personFields, setPersonFields] = useState<PersonField[]>([]);
  const [personFieldsSample, setPersonFieldsSample] = useState<number>(0);
  const [personFieldsError, setPersonFieldsError] = useState<string | null>(null);
  const personFieldsLoadedFor = useRef<number | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<JiraTestResult | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templateColumns, setTemplateColumns] = useState<string[] | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  /** The active mapping as loaded from the server: version, sample file, and its header list. */
  const [mappingMeta, setMappingMeta] = useState<MappingDetails | null>(null);
  const initialMappingRef = useRef<Record<string, string>>({});
  /** Fields whose value came from the AI draft rather than the user, so unreviewed ones are visible. */
  const [suggestedFields, setSuggestedFields] = useState<Set<string>>(new Set());
  /** A picked file held back until the user confirms replacing the mapping already in place. */
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  /*
   * Column options come from a freshly read sample when there is one, and otherwise from the header
   * list stored with the active mapping. Without the stored list, reopening a project for editing
   * left every dropdown empty -- the mapping could only be changed by uploading the file again.
   */
  const columnOptions = templateColumns ?? mappingMeta?.sourceHeaders ?? [];

  /*
   * The importer's mappable fields. Keyed by the internal field name, not the label -- the saved
   * mapping comes back from the server under these keys, so labelling the state meant an existing
   * mapping never repopulated the form when reopening a project for editing.
   *
   * Mirrors MAPPABLE_FIELDS in backend/src/modules/datasource/excelTemplateValidator.ts; the server
   * accepts either the key or the label, so the two cannot silently disagree.
   */
  const headers: Array<{ key: string; label: string }> = [
    { key: 'externalId', label: 'External ID' },
    { key: 'title', label: 'Title' },
    { key: 'type', label: 'Type' },
    { key: 'status', label: 'Status' },
    { key: 'sprintName', label: 'Sprint Name' },
    { key: 'assigneeEmail', label: 'Assignee Email' },
    { key: 'createdDate', label: 'Created Date' },
    { key: 'lastUpdated', label: 'Last Updated' },
    { key: 'sprintStartDate', label: 'Sprint Start Date' },
    { key: 'sprintEndDate', label: 'Sprint End Date' },
    { key: 'storyPoints', label: 'Story Points' },
    // Read by the importer but previously not offerable here, so they could never be mapped.
    { key: 'priority', label: 'Priority' },
    { key: 'statusChangedOn', label: 'Status Changed On' },
    { key: 'doneDate', label: 'Done Date' },
    // Identifies Epic/Feature rows as containers, which are then left out of the metrics.
    { key: 'parentExtId', label: 'Parent / Epic' },
    { key: 'labels', label: 'Labels' },
  ];

  const initial = editing ? formFromProject(editing) : emptyForm(defaultAccountId ?? '');
  
  const NAME_REGEX = /^[A-Za-z]+(?:[ ]?[A-Za-z]+)*$/;
  const JIRA_BASE_URL = /^(https?):\/\/([a-zA-Z0-9.-]+)(:\d{1,5})?(\/[a-zA-Z0-9._-]+)?$/;
  const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

  const laneConfigSchema = z.object({
    assigneeMode: z.enum(["separate", "shared"]),
    ownerFields: z.object({
      developer: z.string().trim(),
      qa: z.string().trim(),
      uat: z.string().trim(),
    }),
    creditChangelogAuthor: z.boolean(),
    todo: z.string(),
    in_progress: z.string(),
    blocked: z.string(),
    in_review: z.string(),
    qa: z.string(),
    uat: z.string(),
    done: z.string(),
    reopened: z.string(),
  });

  const formSchema = z.object({
    name: z.string().min(1,{message: 'Name is required'}).regex(NAME_REGEX, { message: "Name must contain only letters", }),
    code: z.string().min(1, {message: 'Code is required'}),
    accountId: z.union([z.number(), z.literal("")]),
    dataSourceType: z.custom<DataSourceType>((val) => typeof val === 'string'),
    reportingFrequency: z.enum(['daily', 'weekly', 'sprint']),
    jiraBoardId:  z.union([z.string(), z.literal("")]),
    jiraName: z.string(),
    jiraBaseUrl:  z.union([z.string().regex(JIRA_BASE_URL, { message: "Invalid base url", }), z.literal("")]),
    jiraEmail: z.string().regex(EMAIL_REGEX, { message: "Invalid email format" }).or(z.literal("")),
    jiraApiToken: z.string(),
    azureOrgUrl: z.string(),
    azureProject: z.string(),
    azureTeam: z.string(),
    azurePat: z.string(),
    azureBoardId: z.string(),
    isSharedTeam: z.boolean(),
    isKanbanProject: z.boolean(),
    sprintAssignmentModel:  z.enum(['planned' , 'on_the_go']),
    piiRedactionEnabled: z.boolean(),
    kanbanDoneStatuses: z.string(),
    kanbanCycleDays: z.union([z.number(), z.literal("")]),
    kanbanCycleStrideDays: z.union([z.number(), z.literal("")]),
    kanbanCycleAnchorDate: z.string(),
    kanbanAutoSync: z.boolean(),
    estimationType: z.enum(['story_points' , 'hours']),
    hoursSource: z.enum(['time_tracking' , 'custom_field']),
    hoursFieldName: z.string(),
    defaultDailyCapacityHours: z.union([z.number(), z.literal("")]),
    isActive: z.boolean(),
    inactiveSince: z.union([z.string(), z.null()]),
    laneConfig: laneConfigSchema,
    devAssistantAiTool: z.enum(['claude' , 'copilot' , 'openai' , 'cursor' , 'none']),
  })
  .superRefine((data, ctx) => {
    if (data.dataSourceType === 'jira') {
      if (!data.jiraBoardId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["jiraBoardId"],
          message: "jiraBoardId is required",
        });
      } 
       if (!data.jiraBaseUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["jiraBaseUrl"],
          message: "jiraBaseUrl is required",
        });
      } 
     
    }
  });

  useEffect(() => {
    if (!open) return;
    initialFormRef.current = initial;
    setTestResult(null);
    // Mapping state is per-dialog-session; without this it leaks into the next project edited.
    setColumnMapping({});
    initialMappingRef.current = {};
    setTemplateColumns(null);
    setMappingMeta(null);
    setSuggestedFields(new Set());
    setPendingFile(null);
    setFile(null);
    setError(null);
  }, [open, editing, defaultAccountId]);
  
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    control,
    formState: { errors },
  } = useForm<ProjectForm>({
    values: initial,
    resolver: zodResolver(formSchema),
    mode: "onChange",
  });

  useEffect(() => {
    if (!open || !editing || typeof editing.id !== 'number' || editing.dataSourceType !== 'excel') return;

    let cancelled = false;
    const loadMapping = async () => {
      try {
        const details = await fetchMappingDetails.mutateAsync(editing.id as number);
        if (cancelled) return;

        setMappingMeta(details);
        setColumnMapping(details?.mapping ?? {});
        // Baseline for the dirty check, so merely opening and closing a project does not mint a
        // new mapping version.
        initialMappingRef.current = details?.mapping ?? {};
      } catch {
        // A project with no mapping yet is normal; start from an empty form.
        if (!cancelled) {
          setMappingMeta(null);
          setColumnMapping({});
          initialMappingRef.current = {};
        }
      }
    };
    loadMapping();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const handleTest = async (data: ProjectForm) => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testJira.mutateAsync({
        jiraBaseUrl: data.jiraBaseUrl,
        jiraEmail: data.jiraEmail,
        jiraApiToken: data.jiraApiToken,
        jiraBoardId: Number(data.jiraBoardId),
      });
      setTestResult({ ok: true, label: `Connected: "${result.boardName}" (${result.boardType})` });
    } catch (e: any) {
      const msg = e.response?.data?.message || 'Connection failed';
      setTestResult({ ok: false, label: msg });
    } finally {
      setTesting(false);
    }
  };

  /**
   * Load the board's person-type fields, lazily — only when the ownership section is
   * opened, since it samples a sprint from Jira. Cached per project for the dialog's life.
   * Only meaningful for a saved project: an unsaved one has no board to inspect yet.
   */
  const loadPersonFields = async () => {
    if (!editing?.id || personFieldsLoadedFor.current === editing.id) return;
    personFieldsLoadedFor.current = editing.id;
    setPersonFieldsError(null);
    try {
      const res = await client.get<any>(`/admin/projects/${editing.id}/person-fields`);
      setPersonFields(res.data?.fields ?? []);
      setPersonFieldsSample(res.data?.sampleSize ?? 0);
    } catch (e: any) {
      personFieldsLoadedFor.current = null; // let the user retry by collapsing and reopening
      setPersonFieldsError(
        e?.response?.data?.message ?? 'Could not read the field list from Jira. You can still type field names manually.',
      );
    }
  };

  const handleSave = async (data: ProjectForm ) => {
    setSaving(true);
    try {
      // inactiveSince is server-managed (stamped on the active->inactive transition); never send it.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const payload = {
        name: data.name, code: data.code, accountId: data.accountId, dataSourceType: data.dataSourceType, jiraBoardId: data.jiraBoardId, jiraName: data.jiraName, jiraBaseUrl: data.jiraBaseUrl, jiraEmail: data.jiraEmail, jiraApiToken: data.jiraApiToken,
        kanbanDoneStatuses: data.kanbanDoneStatuses
          ? data.kanbanDoneStatuses.split(',').map(s => s.trim()).filter(Boolean)
          : null,
        kanbanCycleEnabled: !!data.isKanbanProject && !!data.kanbanCycleDays && !!data.kanbanCycleAnchorDate,
        jiraLaneConfig: laneConfigToPayload(data.laneConfig),
      };

      /*
       * Save the mapping only when it is usable AND actually changed. Every save mints a new
       * version and supersedes the previous one, so an unrelated project edit must not churn the
       * mapping history. External ID is the one column the backend requires.
       */
      const mappingChanged =
        !!file || JSON.stringify(columnMapping) !== JSON.stringify(initialMappingRef.current);
      const hasMapping = data.dataSourceType === 'excel' && !!columnMapping.externalId && mappingChanged;

      const isFormDirty = JSON.stringify(data) !== JSON.stringify(initialFormRef.current);

      if (editing) {
        if (isFormDirty) {
          await updateProject.mutateAsync({ id: editing.id, data: payload });
        }
        if (hasMapping || data.dataSourceType === 'custom-excel') {
          await saveProjectMapping.mutateAsync({ id: editing.id, data: { ...columnMapping, dataSource: data.dataSourceType }, file });
          setSnackbar({ msg: 'Column mapping saved.', severity: 'success' });
        }
        if (isFormDirty || hasMapping) {
          onSuccess('Project updated');
        }
      } else {
        /*
         * Create, then attach the mapping to the project that was just created — one click, no
         * reopen. The mapping section used to be hidden on create precisely because it needs a
         * project id; sequencing the two calls here is what removes that restriction.
         */
        const created = await createProject.mutateAsync(payload);

        if (hasMapping && created?.id) {
          await saveProjectMapping.mutateAsync({ id: created.id, data: columnMapping, file });
        }

        onSuccess(hasMapping ? 'Project created with its column mapping' : 'Project created');
      }

      onClose();
    } catch (e: any) {
      onError(e.response?.data?.message || 'Save failed');
      setSnackbar({ msg: e.response?.data?.message || 'Save failed', severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const canTest =
    watch('dataSourceType') === 'jira' &&
    !!watch('jiraBaseUrl') && !!watch('jiraEmail') && !!watch('jiraApiToken') && !!watch('jiraBoardId');
  // Mirrors validateKanbanCadence on the backend (kanbanCycleService.ts) — kept
  // as a plain boolean rather than importing the shared function so the admin
  // bundle doesn't pull in report-service code. A stride shorter than the
  // window must never reach Save: it previously only turned the field red
  // while leaving the button enabled, so the invalid pair still hit the API
  // and depended on the (now-added) server-side check to be rejected.
  const kanbanCadenceValid =
    !watch('isKanbanProject') || watch('kanbanCycleStrideDays') === '' ||
    Number(watch('kanbanCycleStrideDays')) >= Number(watch('kanbanCycleDays') || 0);

  const canSave =
    !!watch('name') && !!watch('code') && !!watch('accountId') &&
    (
      (watch('dataSourceType') === 'jira' && !!watch('jiraBoardId') && !!watch('jiraBaseUrl')) ||
      watch('dataSourceType') !== 'jira'
    ) &&
    kanbanCadenceValid;

  /**
   * Reads a sample file's headers and proposes a mapping for them.
   *
   * The headers are read server-side rather than in the browser: the same reader then parses every
   * upload, so what the mapping is built against is exactly what the importer will see. Only the
   * header row is used — no row values are read, so nothing customer-identifying is involved.
   */
  const applyFile = async (f: File) => {
    // Never leave a previous file's columns or error on screen alongside a new selection.
    setFile(f);
    setError(null);
    setTemplateColumns(null);
    setBusy(true);

    try {
      const { headers: fileHeaders, suggestions } = await suggestMapping.mutateAsync(f);

      setTemplateColumns(fileHeaders);
      // A new sample replaces the draft outright rather than carrying old choices across files.
      setColumnMapping(suggestions);
      setSuggestedFields(new Set(Object.keys(suggestions)));
    } catch (e: any) {
      setFile(null);
      setError(
        e?.response?.data?.error ||
        `Could not read "${f.name}". Check it is a valid .xlsx, .xls or .csv and not password-protected.`,
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * A sample file replacing an existing mapping is a supersede, not an edit — imports already
   * processed keep the mapping that parsed them. Confirm before discarding the current draft.
   */
  const handleFile = (f?: File) => {
    if (!f) {
      return;
    }

    if (mappingMeta || Object.keys(initialMappingRef.current).length > 0) {
      setPendingFile(f);
      return;
    }

    void applyFile(f);
  };

  return (
    <Dialog open={open} onClose={closeOnEscapeOnly(onClose)} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        {editing ? 'Edit Project' : 'New Project'}
        <DialogCloseButton onClick={onClose} disabled={saving} />
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'grid', gap: 2, pt: 1 }}>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="Project Name"
              required
              fullWidth
              {...register("name")}
              error={!!errors.name}
              helperText={errors.name?.message || ""}
            />
            <TextField
              label="Code"
              required
              fullWidth
              {...register("code", {
                onChange: (e) => { e.target.value = e.target.value.toUpperCase(); }
              })}
              error={!!errors.code}
              helperText={errors.code?.message || "Short unique code"}
            />
          </Box>
          <FormControl required fullWidth>
            <InputLabel id="account-select-label">Account</InputLabel>
            <Controller
              name="accountId"
              control={control}
              defaultValue="" 
              render={({ field }) => (
                <Select
                  {...field}
                  labelId="account-select-label"
                  label="Account"
                  onChange={(e) => {
                    field.onChange(Number(e.target.value)); 
                  }}
                  value={field.value ?? ""} 
                >
                  {accounts.map((a) => (
                    <MenuItem key={a.id} value={a.id}>
                      {a.name}
                    </MenuItem>
                  ))}
                </Select>
              )}
            />
          </FormControl>
          
          <Divider>
            <Typography variant="caption" color="text.secondary">Data Source</Typography>
          </Divider>

          <ToggleButtonGroup
            exclusive
            onChange={(_, v) => {
              if (!v) return;
              const next = v as DataSourceType;
              setValue("dataSourceType", next);
              if (next === "excel") {
                setValue("isKanbanProject", false);
                setValue("isSharedTeam", false);
                setValue("kanbanDoneStatuses", "");
                setValue("sprintAssignmentModel", "planned");
              }
            }}
            fullWidth
            size="small"
          >
            <ToggleButton value="jira">Jira</ToggleButton>
            <ToggleButton value="excel">Excel Upload</ToggleButton>
            <ToggleButton value="custom-excel">Custom Excel Upload</ToggleButton>
          </ToggleButtonGroup>

          {watch('dataSourceType') === 'jira' && (
            <>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  label="Jira Board ID"
                  type="number"
                  required
                  fullWidth
                  {...register('jiraBoardId')}
                  error={!!errors.jiraBoardId}
                  helperText={errors.jiraBoardId?.message || ""}
                />
                <TextField
                  label="Jira Name"
                  fullWidth
                  {...register("jiraName")}
                  error={!!errors.jiraName}
                  helperText={errors.jiraName?.message || "Display name in Jira"}
                />
              </Box>

              <TextField
                label="Jira Base URL"
                required
                fullWidth
                placeholder="https://yourorg.atlassian.net"
                {...register('jiraBaseUrl')}
                  error={!!errors.jiraBaseUrl}
                  helperText={errors.jiraBaseUrl?.message || ""}
              />

              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  label="Jira Email"
                  type="email"
                  fullWidth
                  error={!!errors.jiraEmail}
                  helperText={errors.jiraEmail?.message || ""}
                  onChange={e => {
                    setValue('jiraEmail', e.target.value);
                    setTestResult(null);
                  }}
                />
                <TextField
                  label="Jira API Token"
                  type="password"
                  fullWidth
                  onChange={e => {
                    setValue('jiraApiToken', e.target.value );
                    setTestResult(null);
                  }}
                />
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Button variant="outlined" size="small" onClick={handleSubmit(handleTest)} disabled={testing || !canTest}>
                  {testing ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
                  Test Jira Connection
                </Button>
                {testResult && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {testResult.ok
                      ? <CheckCircle fontSize="small" color="success" />
                      : <ErrorIcon fontSize="small" color="error" />}
                    <Typography variant="caption" color={testResult.ok ? 'success.main' : 'error.main'}>
                      {testResult.label}
                    </Typography>
                  </Box>
                )}
              </Box>
            </>
          )}

          {(watch('dataSourceType') !== 'jira') && (
            <>
              <Alert severity="info" sx={{ fontSize: 13 }}>
                Excel-based projects are fed from uploaded .xlsx / .csv files rather than Jira.
                Map the customer's column headers below, then upload files from the Data Imports
                page — re-uploading a sprint updates those tickets rather than duplicating them.
              </Alert>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {/*
                  The mapping is built here, during create as well as edit. It used to be hidden on
                  create -- "save the project first, then reopen it" -- because a mapping needs a
                  project id; Save now creates the project and attaches the mapping in one go.
                */}
                {mappingMeta && (
                  <Alert severity="success" icon={false} sx={{ py: 0.5 }}>
                    <Typography variant="caption" component="div">
                      <strong>Active mapping v{mappingMeta.version ?? 1}</strong>
                      {mappingMeta.file ? ` · built from ${mappingMeta.file.originalFilename}` : ''}
                      {mappingMeta.updatedAt
                        ? ` · saved ${new Date(mappingMeta.updatedAt).toLocaleDateString()}`
                        : ''}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      Edit any field below against the {mappingMeta.sourceHeaders.length} columns of that
                      file — no need to upload it again.
                    </Typography>
                  </Alert>
                )}

                <Button
                  variant="outlined"
                  component="label"
                  startIcon={busy ? <CircularProgress size={16} /> : <CloudUpload />}
                  disabled={busy}
                >
                  {busy
                    ? 'Reading columns…'
                    : file
                      ? file.name
                      : mappingMeta
                        ? 'Replace sample file'
                        : 'Choose a sample file'}
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    hidden
                    // Reset so re-picking the same file still fires a change event.
                    onChange={e => {
                      handleFile(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </Button>

                {error && <Alert severity="error">{error}</Alert>}

                {/* Confirms the mapping options below came from THIS file. */}
                {!busy && !error && templateColumns && (
                  <Typography variant="caption" color="success.main">
                    Read {templateColumns.length} column{templateColumns.length === 1 ? '' : 's'}
                    {file ? ` from ${file.name}` : ''}
                    {suggestedFields.size > 0
                      ? ` — ${suggestedFields.size} field${suggestedFields.size === 1 ? '' : 's'} filled in automatically. Check them before saving.`
                      : ' — match them to the fields below.'}
                  </Typography>
                )}

                {!templateColumns && !mappingMeta && !busy && (
                  <Typography variant="caption" color="text.secondary">
                    Optional — you can save the project now and map its columns later, but uploads are
                    rejected until a mapping exists.
                  </Typography>
                )}

                {columnOptions.length > 0 && <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {headers.map((field) => (
                    <Box
                      key={field.key}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: '180px 1fr',
                        alignItems: 'center',
                        gap: 2,
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                        <Typography variant="body2" fontWeight={500}>
                          {field.label}
                        </Typography>
                        {/* Marks a value nobody has looked at yet, so a wrong guess is not mistaken
                            for a deliberate choice. Clears as soon as the field is touched. */}
                        {suggestedFields.has(field.key) && (
                          <Chip size="small" variant="outlined" color="info" label="suggested" />
                        )}
                      </Box>

                      <Autocomplete
                        disablePortal
                        freeSolo
                        fullWidth
                        size="small"
                        options={columnOptions}
                        renderOption={(props, option, { index }) => (
                          <li {...props} key={`${option}-${index}`}>
                            {option}
                          </li>
                        )}
                        value={columnMapping[field.key] || null}
                        getOptionLabel={(option) => option}
                        isOptionEqualToValue={(option, value) => option === value}
                        filterOptions={(options, { inputValue }) => {
                          const search = inputValue.toLowerCase().trim();

                          if (!search) return options;

                          return options.filter(option =>
                            option
                              .toLowerCase()
                              .split(/\s+/)
                              .some(word => word.startsWith(search))
                          );
                        }}
                        onInputChange={(_, value) => {
                          setColumnMapping(prev => ({
                            ...prev,
                            [field.key]: value ?? '',
                          }));
                          // Touched by hand — no longer an unreviewed suggestion.
                          setSuggestedFields(prev => {
                            if (!prev.has(field.key)) return prev;
                            const next = new Set(prev);
                            next.delete(field.key);
                            return next;
                          });
                        }}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            placeholder="Search column..."
                            size="small"
                          />
                        )}
                      />
                    </Box>
                  ))}
                </Box>}
              </Box>
              
              <FormControl fullWidth>
                <InputLabel id="reporting-frequency-label">Reporting Frequency</InputLabel>
                <Controller
                  name="reportingFrequency"
                  control={control}
                  render={({ field }) => (
                    <Select
                      {...field}
                      labelId="reporting-frequency-label"
                      label="Reporting Frequency"
                      onChange={(e) => {
                        field.onChange(e.target.value); 
                      }}
                      value={field.value ?? ""} 
                    >
                      <MenuItem value="daily">Daily</MenuItem>
                      <MenuItem value="sprint">Sprint</MenuItem>
                    </Select>
                  )}
                />
                <FormHelperText>
                  Sprint enables per-sprint uploads and the Excel Sprint Board View. Daily keeps the per-day snapshot upload.
                </FormHelperText>
              </FormControl>
            </>
          )}

          {(watch('dataSourceType') === 'jira') &&
            <>
              <Divider>
                <Typography variant="caption" color="text.secondary">Settings</Typography>
              </Divider>

              <Box sx={{ display: 'flex', gap: 4, flexDirection: 'column' }}>
                <Box sx={{ display: 'flex', gap: 4 }}>
                  <Controller
                    name="isKanbanProject"
                    control={control}
                    render={({ field: { value, onChange } }) => (
                      <FormControlLabel
                        label="Kanban project (no sprint tracking)"
                        control={
                          <Switch
                            checked={value}
                            onChange={(e) => {
                            const isChecked = e.target.checked;
                            onChange(isChecked);
                            if (isChecked) {
                              setValue("sprintAssignmentModel", "planned");
                            }
                          }}
                          />
                        }
                      />
                    )}
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        onChange={e => setValue('isSharedTeam', e.target.checked )}
                      />
                    }
                    label="Shared team"
                  />
                </Box>
                  {!watch('isKanbanProject') && (
                    <FormControl fullWidth sx={{ maxWidth: 420 }}>
                      <InputLabel id="sprint-assignment-model-label">Sprint Assignment Model</InputLabel>
                      <Controller
                        name="sprintAssignmentModel"
                        control={control}
                        defaultValue="planned" 
                        render={({ field }) => (
                          <Select
                            {...field}
                            labelId="sprint-assignment-model-label"
                            label="Sprint Assignment Model"
                            onChange={(e) => {
                              field.onChange(e.target.value); 
                            }}
                            value={field.value ?? ""} 
                          >
                            <MenuItem value="planned">Planned (fixed per-member SP target, e.g. CCM)</MenuItem>
                            <MenuItem value="on_the_go">On the go (team commits to total sprint SP, picks up tickets as they go)</MenuItem>
                          </Select>
                        )}
                      />
                      <FormHelperText>
                        &ldquo;On the go&rdquo; removes sprint pace from the daily report&rsquo;s health score and
                        progress-bar coloring for this project (there is no stable per-person/per-subteam target to
                        measure against) — health is then based on blocked tickets and production bugs only, and the
                        progress bar shows team-wide sprint completion and this team&rsquo;s current workload as plain
                        informational numbers instead.
                      </FormHelperText>
                    </FormControl>
                  )}
                </Box>
            </>
          }

          {/* Applies to every source, not just Jira — Excel-sourced titles run
              through the same ingestion path. */}
          <Controller
            name="piiRedactionEnabled"
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={
                  <Switch
                    checked={field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                  />
                }
                label="Redact personal data from ticket titles (recommended)"
              />
            )}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5, ml: 6 }}>
            Masks emails, phone numbers, SSNs, card and account numbers, and street
            addresses in ticket titles before they are stored or sent for AI analysis.
            Ticket descriptions and comment text are never read, regardless of this setting.
          </Typography>

          {/* isActive/inactiveSince round-trip through the form already (see emptyForm/
              formFromProject above) and the server-side activate/deactivate transition
              in adminController.ts already stamps inactiveSince correctly — this Switch
              was the one missing piece, restoring the only way to actually flip it from
              the UI (previously only a raw PATCH /admin/projects/:id could). */}
          <Controller
            name="isActive"
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={
                  <Switch
                    checked={field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                  />
                }
                label="Active"
              />
            )}
          />

          <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5, ml: 6 }}>
            Turning this off stops future syncs and scheduled report generation for this
            project (daily, weekly, monthly, and its account/program rollups). Existing
            reports are kept; this can be turned back on at any time.
          </Typography>

          <FormControl fullWidth>
            <InputLabel id="account-select-label">Dev Assistant AI Tool</InputLabel>
              <Controller
                name="devAssistantAiTool"
                control={control}
                defaultValue="none" 
                render={({ field }) => (
                  <Select
                    {...field}
                    labelId="dev-assistant-tool-label"
                    label="Dev Assistant AI Tool"
                    onChange={(e) => {
                      field.onChange(e.target.value); 
                    }}
                    value={field.value ?? ""} 
                  >
                    <MenuItem value="none">None</MenuItem>
                    <MenuItem value="claude">Claude</MenuItem>
                    <MenuItem value="copilot">Copilot</MenuItem>
                    <MenuItem value="openai">OpenAI</MenuItem>
                    <MenuItem value="cursor">Cursor</MenuItem>
                  </Select>
                )}
              />
              <FormHelperText>
                Which coding assistant this project&rsquo;s team uses. Controls whether Claude usage
                data appears anywhere for this project&rsquo;s members — leave as None if they don&rsquo;t use Claude.
            </FormHelperText>
          </FormControl>

          <TextField
            label="Done Statuses (override)"
            onChange={e => setValue('kanbanDoneStatuses', e.target.value )}
            fullWidth
            helperText="Comma-separated Jira status names that count as Done for this project. Overrides Jira's default status-category detection — use this when a board's terminal column (e.g. &quot;Closed&quot;) differs from a status Jira itself marks Done (e.g. &quot;Resolved&quot;). Leave blank to use Jira's defaults."
          />

          {watch('isKanbanProject') && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
              <Typography variant="body2" fontWeight={500}>Work-cycle cadence</Typography>
              <Typography variant="caption" color="text.secondary">
                Kanban boards have no sprints. Set the team's working window and a start date; the system generates
                cycle periods you can sync for Team Performance. If the team works Mon–Fri and regroups weekly, set
                Working window to 5 days and Repeats every to 7 — that leaves the weekend out of every cycle. Leave
                Repeats every blank for back-to-back cycles with no gap.
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <FormControl sx={{ minWidth: 180 }}>
                  <InputLabel id="kanban-cadence-label"></InputLabel>
                 <Controller
                  name="kanbanCycleDays"
                  control={control}
                  render={({ field }) => {
                    const selectValue = 
                    field.value === 7 ? 'weekly' : 
                    field.value === 14 ? 'biweekly' : 
                    'custom';
                    return (
                      <FormControl sx={{ minWidth: 180 }}>
                      <InputLabel id="kanban-cadence-label">Working window</InputLabel>
                      <Select
                        labelId="kanban-cadence-label"
                        label="Working window"
                        value={selectValue}
                        onChange={(e) => {
                          const v = e.target.value;
                          const updatedValue = 
                          v === 'weekly' ? 7 : 
                          v === 'biweekly' ? 14 : 
                          (field.value === 7 || field.value === 14 ? '' : field.value);
                           field.onChange(updatedValue);
                        }}
                      >
                      <MenuItem value="weekly">Weekly (7 days)</MenuItem>
                      <MenuItem value="biweekly">Bi-weekly (14 days)</MenuItem>
                      <MenuItem value="custom">Custom</MenuItem>
                      </Select>
                     </FormControl>
                    );
                  }}
                />

                </FormControl>
                {watch('kanbanCycleDays') !== 7 && watch('kanbanCycleDays') !== 14 && (
                  <TextField
                    label="Working window (days)"
                    type="number"
                    onChange={e => setValue('kanbanCycleDays', e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value) || 0) )}
                    sx={{ width: 130 }}
                    inputProps={{ min: 1 }}
                  />
                )}
                <TextField
                  label="Cycle start date"
                  type="date"
                  onChange={e => setValue('kanbanCycleAnchorDate', e.target.value )}
                  InputLabelProps={{ shrink: true }}
                  helperText="Start of the first cycle; all cycles repeat from here"
                />
              </Box>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <TextField
                  label="Repeats every (days)"
                  type="number"
                  onChange={e => setValue('kanbanCycleStrideDays', e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value) || 0) )}
                  sx={{ width: 180 }}
                  inputProps={{ min: 1 }}
                  helperText={
                    watch('kanbanCycleStrideDays') === '' || watch('kanbanCycleStrideDays') === watch('kanbanCycleDays')
                      ? 'Blank = back-to-back cycles (default)'
                      : Number(watch('kanbanCycleStrideDays')) > Number(watch('kanbanCycleDays') || 0)
                        ? 'Leaves a gap after each cycle — e.g. a 5-day cycle repeating every 7 days stays Mon–Fri and skips the weekend'
                        : 'Must be at least the working window, or cycles would overlap'
                  }
                  error={watch('kanbanCycleStrideDays') !== '' && Number(watch('kanbanCycleStrideDays')) < Number(watch('kanbanCycleDays') || 0)}
                />
              </Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={watch('kanbanAutoSync')}
                    disabled={!watch('kanbanCycleDays') || !watch('kanbanCycleAnchorDate')}
                    onChange={e => setValue('kanbanAutoSync', e.target.checked )}
                  />
                }
                label="Auto-sync each cycle when it ends"
              />
            </Box>
          )}

          {(watch('dataSourceType') === 'jira') && (
            <Accordion
              disableGutters
              elevation={0}
              sx={{ border: '1px solid', borderColor: 'divider', '&:before': { display: 'none' } }}
              onChange={(_, expanded) => { if (expanded) void loadPersonFields(); }}
            >
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography variant="body2" fontWeight={500}>Ticket Ownership Fields</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1, alignSelf: 'center' }}>
                  {OWNER_ROLE_KEYS.some(r => !!watch('laneConfig').ownerFields[r]) ? 'Custom' : 'Using defaults'}
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                  Which Jira field names the person in each role. Leave blank to use the default.
                  Jira instances differ: on some boards <strong>Assignee</strong> is the developer, on
                  others it is a work-queue pointer that moves Dev → QA → UAT, and ownership lives in
                  dedicated fields. The percentages below show how often each field is actually filled
                  on the current sprint.
                </Typography>

                {personFieldsError && (
                  <Alert severity="warning" sx={{ mb: 2 }}>{personFieldsError}</Alert>
                )}
                {personFields.length > 0 && (
                  <Box sx={{ mb: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                    <Typography variant="caption" fontWeight={500} sx={{ display: 'block', mb: 0.5 }}>
                      Person fields on this board{personFieldsSample ? ` (${personFieldsSample} tickets sampled)` : ''}:
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {personFields.filter(f => f.likelyDelivery).map(f => (
                        <Chip
                          key={f.id}
                          size="small"
                          variant="outlined"
                          color={f.coveragePct !== null && f.coveragePct >= 50 ? 'primary' : 'default'}
                          label={`${f.name}${f.coveragePct !== null ? ` · ${f.coveragePct}%` : ''}`}
                          title="Click to copy this field name"
                          onClick={() => void navigator.clipboard?.writeText(f.name)}
                        />
                      ))}
                    </Box>
                  </Box>
                )}

                <Box sx={{ display: 'grid', gap: 2 }}>
                  {OWNER_ROLE_KEYS.map((lane) => (
                    <TextField
                      key={lane}
                      label={OWNER_ROLE_LABELS[lane]}
                      fullWidth
                      size="small"
                      placeholder={OWNER_ROLE_DEFAULTS[lane]}
                      helperText={OWNER_ROLE_HELP[lane]}
                    />
                  ))}
                </Box>

                <FormControlLabel
                  sx={{ mt: 1 }}
                  control={
                    <Switch
                      size="small"
                      checked={watch('laneConfig.creditChangelogAuthor')}
                      {...register('laneConfig.creditChangelogAuthor')}
                    />
                  }
                  label={
                    <Typography variant="caption">
                      Also credit whoever moved the ticket — catches work handed on before the report
                      runs, e.g. a developer who fixes a ticket then unassigns it to pass it to QA.
                    </Typography>
                  }
                />
              </AccordionDetails>
            </Accordion>
          )}

          {(watch('dataSourceType') !== 'excel') && (
            <Accordion
              disableGutters
              elevation={0}
              sx={{ border: '1px solid', borderColor: 'divider', '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography variant="body2" fontWeight={500}>Lane Configuration</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1, alignSelf: 'center' }}>
                  {isCustomLaneConfig(watch('laneConfig')) ? 'Custom' : 'Using defaults'}
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ mb: 2 }}>
                  <FormLabel component="legend">
                    <Typography variant="caption" fontWeight={500}>Assignee Mode</Typography>
                  </FormLabel>
                  <RadioGroup
                    row
                    {...register('laneConfig.assigneeMode')}
                  >
                    <FormControlLabel
                      value="separate"
                      control={<Radio size="small" />}
                      label={
                        <Typography variant="caption">
                          Separate — Dev and QA are different Jira users (default)
                        </Typography>
                      }
                    />
                    <FormControlLabel
                      value="shared"
                      control={<Radio size="small" />}
                      label={
                        <Typography variant="caption">
                          Shared — Same assignee field for Dev and QA; changelog used to find developer
                        </Typography>
                      }
                    />
                  </RadioGroup>
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                  Map Jira status names to workflow lanes. Leave blank to use system defaults. Comma-separated, case-insensitive.
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  {LANE_KEYS.map((lane) => (
                    <TextField
                      key={lane}
                      label={LANE_LABELS[lane]}
                      placeholder={LANE_DEFAULTS[lane]}
                      fullWidth
                      size="small"
                      {...register(`laneConfig.${lane}`)}
                    />
                  ))}
                </Box>
              </AccordionDetails>
            </Accordion>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button type='button' variant="contained" onClick={handleSubmit(handleSave)} disabled={saving || !canSave}>
          {saving ? <CircularProgress size={18} /> : 'Save'}
        </Button>
      </DialogActions>

      {/*
        A project has exactly one active mapping. Replacing the sample supersedes it rather than
        editing it, and the current draft is discarded in favour of a fresh reading of the new file
        — worth confirming, because the choices already made here are lost.
      */}
      <Dialog open={!!pendingFile} onClose={() => setPendingFile(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pr: 6 }}>
          Replace the sample file?
          <DialogCloseButton onClick={() => setPendingFile(null)} />
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" gutterBottom>
            The mapping will be rebuilt from <strong>{pendingFile?.name}</strong>, and the choices
            currently on screen are replaced.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Data already imported is kept exactly as it is. Those uploads stay linked to the mapping
            that parsed them and are marked as using an earlier version.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingFile(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              const next = pendingFile;
              setPendingFile(null);
              if (next) void applyFile(next);
            }}
          >
            Replace mapping
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
};
