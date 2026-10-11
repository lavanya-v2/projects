import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Autocomplete,
  Box,
  FormControl,
  FormLabel,
  RadioGroup,
  Radio,
  Typography,
  Divider,
  Paper,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Checkbox,
  Select,
  MenuItem,
  CircularProgress,
} from "@mui/material";
import {
  Controller,
  useFieldArray,
  useForm,
  type Resolver,
} from "react-hook-form";
import {
  useAdminCreateTeamMember,
  useAdminUpdateTeamMember,
} from "../../../team-members/hooks";
import { PROJECT_ROLES, DEFAULT_PROJECT_ROLE } from "../../constants";
import { DialogCloseButton } from "../../../../../shared/components/dialogHelpers";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAdminAddProjectMembers } from "../../../projects/hooks";
import type { ProjectMembers } from "../../types";
import type { Project } from "../../../../../types";
import { memberProjectRoles } from "../../helpers";
import { existingMemberSchema, memberSchema } from "../utils/memberSchema";

interface ProjectAssignment {
  projectId: number | null;
  projectName: string;
  checked: boolean;
  role: string;
}

interface AccountMemberDialogProps {
  open: boolean;
  formMode: string;
  member: ProjectMembers | null;
  accountId: number | null;
  accountProjects: Project[];
  /** Members available to link (already in this account). */
  availableToLink: ProjectMembers[] | null;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

interface FormInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  jiraLoginId?: string;
  partnerEmailId?: string;
  linkedMember?: ProjectMembers | null;
}

interface ProjectAssignmentForm {
  assignProjects: ProjectAssignment[];
}

const memberForm = (member: ProjectMembers | null): FormInput => ({
  firstName: member?.firstName ?? "",
  lastName: member?.lastName ?? "",
  email: member?.email ?? "",
  jiraLoginId: member?.jiraLoginId ?? "",
  partnerEmailId: member?.partnerEmailId ?? "",
  linkedMember: null,
});

/** Account-level "Add Team Member" dialog with create-new vs. link-existing modes. */
export const AccountMemberDialog = ({
  open,
  formMode,
  member,
  accountId,
  accountProjects,
  availableToLink,
  onClose,
  onSuccess,
  onError,
}: AccountMemberDialogProps) => {
  const createMember = useAdminCreateTeamMember();
  const updateMember = useAdminUpdateTeamMember();
  const addProjectMembers = useAdminAddProjectMembers();
  const [mode, setMode] = useState<"create" | "link">("create");
  const [saving, setSaving] = useState(false);
  const form = useMemo(() => memberForm(member), [member]);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    control: formInput,
    formState: { errors, isValid: isFormValid, isDirty },
  } = useForm<FormInput>({
    mode: "onChange",
    values: form,
    resolver: zodResolver(
      mode === "create" ? memberSchema : existingMemberSchema,
    ) as Resolver<FormInput>,
  });
  const linkedMember = watch("linkedMember") ?? null;

  const {
    control,
    reset: roleFormReset,
    formState: { isDirty: isRoleUpdated },
  } = useForm<ProjectAssignmentForm>({
    mode: "onChange",
    defaultValues: {
      assignProjects: [
        {
          projectId: null,
          projectName: "",
          checked: false,
          role: "",
        },
      ],
    },
  });

  const { fields: visibleProjects, update } = useFieldArray({
    control,
    name: "assignProjects",
  });

  useEffect(() => {
    if (!open) return;
    setMode("create");
    if (formMode === "create") {
      const initialAssignments = accountProjects.map((p) => ({
        projectId: p.id,
        projectName: p.name,
        checked: false,
        role: DEFAULT_PROJECT_ROLE,
      }));
      roleFormReset({
        assignProjects: initialAssignments,
      });
    } else if (accountId != null) {
      const existingValues = memberProjectRoles(
        member,
        accountProjects,
        accountId,
      );
      roleFormReset({
        assignProjects: existingValues,
      });
    }
  }, [open, formMode, accountId, member, accountProjects, roleFormReset]);

  const accountProjectIdSet = useMemo(
    () => new Set(accountProjects.map((p) => p.id)),
    [accountProjects],
  );

  /** When linking, hide projects the selected member is already assigned to. */
  const visibleAssignments = useMemo(() => {
    if (mode !== "link" || !linkedMember) return visibleProjects;
    const existing = new Set<number>(
      (linkedMember.accountAssociations || [])
        .map((a) => (a.projectId != null ? a.projectId : a.project?.id))
        .filter((id) => id != null && accountProjectIdSet.has(id)),
    );
    return visibleProjects.filter(
      (pa) => pa.projectId != null && !existing.has(pa.projectId),
    );
  }, [mode, linkedMember, visibleProjects, accountProjectIdSet]);

  const toggle = (projectId: number) => {
    const index = visibleProjects.findIndex(
      (item) => item.projectId === projectId,
    );
    if (index !== -1) {
      const currentItem = visibleProjects[index];
      const isNowChecked = !currentItem.checked;
      update(index, {
        ...currentItem,
        checked: isNowChecked,
        role: isNowChecked ? currentItem.role : DEFAULT_PROJECT_ROLE,
      });
    }
  };
  const setRole = (projectId: number, newRole: string) => {
    const index = visibleProjects.findIndex(
      (item) => item.projectId === projectId,
    );
    if (index !== -1) {
      const currentItem = visibleProjects[index];
      update(index, {
        ...currentItem,
        role: newRole,
      });
    }
  };
  const isButtonEnabled =
    formMode === "edit"
      ? isRoleUpdated || isDirty
      : mode === "create"
        ? isFormValid
        : !!linkedMember;
  const getProjectAssignmentsForSave = (
    isCreate: boolean,
  ): Array<{
    id?: number;
    projectId: number;
    role: string;
  }> => {
    return visibleProjects
      .filter(
        (project): project is typeof project & { projectId: number } =>
          project.projectId != null && (isCreate ? project.checked : true),
      )
      .map((project) => {
        const association = isCreate
          ? undefined
          : member?.accountAssociations?.find(
              (item) => item.projectId === project.projectId,
            );
        return {
          ...(association?.id != null && { id: association.id }),
          projectId: project.projectId,
          role: project.role,
        };
      });
  };

  const handleSaveRoles = async (teamMemberId: number, isCreate: boolean) => {
    if (!accountId) return;
    const projects = getProjectAssignmentsForSave(isCreate);
    if (!projects.length) return;
    await addProjectMembers.mutateAsync({
      accountId,
      teamMemberId,
      data: projects,
    });
  };
  const handleSave = async (data: FormInput) => {
    setSaving(true);
    try {
      let memberId: number;
      if (formMode === "edit" && member) {
        if (isDirty) {
          await updateMember.mutateAsync({ id: member.id, data: data });
        }
        if (isRoleUpdated && member) {
          await handleSaveRoles(member.id, false);
        }
      } else {
        if (mode === "create") {
          const created = await createMember.mutateAsync(data);
          memberId = created.id;
          reset();
        } else {
          if (!linkedMember) throw new Error("No member selected");
          memberId = linkedMember.id;
        }
        await handleSaveRoles(memberId, true);
      }
      onSuccess(
        formMode === "edit"
          ? "Team member updated"
          : mode === "create"
            ? "Team member created"
            : "Team member linked",
      );
      reset();
      onClose();
    } catch (e) {
      const message = (e as { response?: { data?: { message?: string } } })
        .response?.data?.message;
      onError(message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const closeAndReset = (_event: object, reason: string) => {
    if (reason !== "backdropClick") {
      reset();
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={closeAndReset}
      maxWidth="md"
      fullWidth
      scroll="paper"
    >
      <DialogTitle sx={{ pr: 6 }}>
        {formMode === "create" ? "Add Team Member" : "Edit Team Member"}
        <DialogCloseButton onClick={onClose} />
      </DialogTitle>
      <DialogContent
        dividers
        sx={{ display: "flex", flexDirection: "column", gap: 2 }}
      >
        {formMode === "create" && (
          <FormControl>
            <FormLabel>How do you want to add this member?</FormLabel>
            <RadioGroup
              row
              value={mode}
              onChange={(e) => {
                reset();
                setMode(e.target.value as "create" | "link");
                roleFormReset();
              }}
            >
              <Radio value="create" size="small" />
              <Typography variant="body2" sx={{ mr: 3, alignSelf: "center" }}>
                Create new
              </Typography>
              <Radio value="link" size="small" />
              <Typography variant="body2" sx={{ alignSelf: "center" }}>
                Link existing member
              </Typography>
            </RadioGroup>
          </FormControl>
        )}
        {mode !== "link" && (
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
            <TextField
              label="First Name"
              required
              {...register("firstName")}
              error={!!errors.firstName}
              helperText={errors.firstName?.message || ""}
            />
            <TextField
              label="Last Name"
              required
              {...register("lastName")}
              error={!!errors.lastName}
              helperText={errors.lastName?.message || ""}
            />
            <TextField
              label="Email"
              required
              {...register("email")}
              error={!!errors.email}
              helperText={errors.email?.message || ""}
            />
            <TextField
              label="Jira Login Id"
              required
              {...register("jiraLoginId")}
              error={!!errors.jiraLoginId}
              helperText={errors.jiraLoginId?.message || ""}
            />
            <TextField
              label="Partner Email Id"
              {...register("partnerEmailId")}
              error={!!errors.partnerEmailId}
              helperText={errors.partnerEmailId?.message || ""}
            />
          </Box>
        )}

        {mode === "link" && availableToLink !== null && (
          <Controller
            name="linkedMember"
            control={formInput}
            render={({ field: { onChange, value }, fieldState: { error } }) => (
              <Autocomplete
                options={availableToLink}
                getOptionLabel={(m) =>
                  `${m.firstName} ${m.lastName} (${m.email})`
                }
                value={value}
                onChange={(_, data) => onChange(data)}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Select existing team member"
                    required
                    error={!!error}
                    helperText={error ? error.message : null}
                  />
                )}
              />
            )}
          />
        )}

        {visibleAssignments.length > 0 && (
          <>
            <Divider>
              <Typography variant="caption" color="text.secondary">
                {formMode === "create"
                  ? mode === "link"
                    ? "Select at least one project"
                    : "Assign to projects (optional)"
                  : " Project Roles"}
              </Typography>
            </Divider>
            <TableContainer
              component={Paper}
              elevation={0}
              sx={{ border: "1px solid", borderColor: "divider" }}
            >
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    {formMode === "create" ? (
                      <TableCell
                        padding="checkbox"
                        sx={{ bgcolor: "#f5f5f5" }}
                      />
                    ) : (
                      <TableCell sx={{ bgcolor: "#f5f5f5" }} />
                    )}
                    <TableCell sx={{ bgcolor: "#f5f5f5" }}>
                      <b>Project</b>
                    </TableCell>
                    <TableCell sx={{ bgcolor: "#f5f5f5" }}>
                      <b>Role</b>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visibleAssignments.map((pa) => (
                    <TableRow key={pa.id}>
                      {formMode === "create" ? (
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={pa.checked}
                            size="small"
                            onChange={() => toggle(pa.projectId as number)}
                          />
                        </TableCell>
                      ) : (
                        <TableCell />
                      )}
                      <TableCell>{pa.projectName}</TableCell>
                      <TableCell>
                        <FormControl
                          size="small"
                          fullWidth
                          disabled={formMode === "create" ? !pa.checked : false}
                        >
                          <Select
                            value={pa.role}
                            onChange={(e) =>
                              setRole(pa.projectId as number, e.target.value)
                            }
                          >
                            {PROJECT_ROLES.map((r) => (
                              <MenuItem key={r} value={r}>
                                {r}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit(handleSave)}
          disabled={
            saving ||
            !isButtonEnabled ||
            visibleAssignments.length === 0 ||
            (mode === "link" &&
              !visibleAssignments.some((project) => project.checked))
          }
        >
          {saving ? <CircularProgress size={18} /> : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
