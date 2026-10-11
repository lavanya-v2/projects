import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Switch,
  FormControlLabel,
  Checkbox,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Alert,
  MenuItem,
  InputLabel,
  FormControl,
  Select,
  Chip,
} from "@mui/material";
import type { Role, User, UserPermission } from "./types";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useCreateUser, useUpdateUser } from "./hooks";
import type { Project } from "../../../types";
import type { Account } from "../accounts/types";
import ConfirmationDialog from "../../../shared/components/ConfirmationDialog";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import type { Resolver } from "react-hook-form";
import { EMAIL_REGEX, NAME_REGEX } from "../../../shared/utils/regexExpression";

interface UserModalProps {
  accounts: Account[];
  projects: Project[];
  roles: Role[];
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  user: User | null; // null means create mode
  setSnackBar: (
    value: { msg: string; severity: "success" | "error" } | null,
  ) => void;
  setSnackBarOpen: (open: boolean) => void;
}

interface UserFormData {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  isActive: boolean;
  roleName: string;
  claudeUsagePilot: boolean;
  changePassword?: boolean;
  permissions?: UserPermission[];
}

// Build the modal's ACCOUNT-scoped permission state from a user's raw permissions.
// Program-scoped rows (programId != null) are owned by the Programs admin UI and the
// backend preserves them on save, so they must be excluded here — otherwise their
// empty projectIds get conflated with the account row and silently grant full access.
// Multiple account-scoped rows for the same account are merged: a full-access ([]) row
// wins, otherwise the project ids are unioned.
function seedAccountPermissions(
  permissions: UserPermission[] = [],
  projects: Project[] = [],
): UserPermission[] {
  const projectsByAccount = new Map<number, number[]>();
  for (const project of projects) {
    const accountId = project.accountId ?? project.account?.id;
    if (!accountId) continue;

    const accountProjectIds = projectsByAccount.get(accountId) ?? [];
    accountProjectIds.push(project.id);
    projectsByAccount.set(accountId, accountProjectIds);
  }

  const byAccount = new Map<number, { full: boolean; ids: Set<number> }>();
  for (const permission of permissions) {
    if (permission.programId != null) continue; // skip program-scoped rows
    const entry = byAccount.get(permission.accountId) ?? {
      full: false,
      ids: new Set<number>(),
    };
    if (!permission.projectIds || permission.projectIds.length === 0) {
      entry.full = true;
    } else {
      permission.projectIds.forEach((id) => entry.ids.add(id));
    }
    byAccount.set(permission.accountId, entry);
  }
  return [...byAccount.entries()].map(([accountId, entry]) => ({
    accountId, projectIds: entry.full ? (projectsByAccount.get(accountId) ?? []) : [...entry.ids],
  }));
}

//Form Schema
const userForm = (user?: User, projects: Project[] = []): UserFormData => ({
  userId: user?.userId || "",
  firstName: user?.firstName || "",
  lastName: user?.lastName || "",
  email: user?.email ?? "",
  password: "", // Don't populate password on edit
  isActive: user?.isActive ?? true,
  roleName: user?.roleName || "member",
  claudeUsagePilot: user?.claudeUsagePilot ?? false,
  changePassword: user ? false : undefined,
  permissions: user ? seedAccountPermissions(user.permissions || [], projects) : [],
});

//Zod Validation
const userPermissionSchema = z.object({
  accountId: z.number(),
  projectIds: z.array(z.number()),
});

const formSchema = z.object({
  userId: z
    .string()
    .min(1, { message: "Email is required" })
    .regex(EMAIL_REGEX, {
      message: "Invalid email format",
    }),
  firstName: z
    .string()
    .min(1, { message: "First name is required" })
    .regex(NAME_REGEX, {
      message: "First Name must only contain letters",
    }),
  lastName: z
    .string()
    .min(1, { message: "Last name is required" })
    .regex(NAME_REGEX, {
      message: "Last Name must only contain letters",
    }),
  password: z
    .string()
    .min(1, { message: "Password is required" })
    .min(6, { message: "Password must be at least 6 characters" }),
  roleName: z.string(),
  email: z
    .string()
    .regex(EMAIL_REGEX, { message: "Invalid email format" })
    .or(z.literal("")),
  isActive: z.boolean(),
  claudeUsagePilot: z.boolean(),
  permissions: z.array(userPermissionSchema),
});

const editFormSchema = formSchema
  .extend({
    changePassword: z.boolean().optional(),
    password: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.changePassword) {
      if (!data.password) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["password"],
          message: "Password is required",
        });
      } else if (data.password.length < 6) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["password"],
          message: "Password must be at least 6 characters",
        });
      }
    }
  });

const UserModal: React.FC<UserModalProps> = ({
  accounts,
  projects,
  roles,
  open,
  onClose,
  onSuccess,
  user,
  setSnackBar,
  setSnackBarOpen,
}) => {
  const isEditMode = !!user;

  const projectsByAccount = useMemo(() => {
    const map = new Map<number, Project[]>();

    projects.forEach((project) => {
      const accountId = project.accountId ?? project.account?.id;
      if (!accountId) return;

      const accountProjects = map.get(accountId) ?? [];
      accountProjects.push(project);
      map.set(accountId, accountProjects);
    });

    return map;
  }, [projects]);

  const schema = user ? editFormSchema : formSchema;
  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    clearErrors,
    control,
    formState: { errors, isValid, isDirty },
  } = useForm<UserFormData>({
    defaultValues: userForm(user ?? undefined, projects),
    resolver: zodResolver(schema) as Resolver<UserFormData>,
    mode: "onChange",
  });

  useEffect(() => {
    reset(user ? userForm(user, projects) : userForm(undefined, projects));
  }, [user, projects, reset]);

  const { append, remove, update } = useFieldArray({
    control,
    name: "permissions",
  });

  const isActive = watch("isActive");
  const isClaudeUsagePilot = watch("claudeUsagePilot");
  const isChangePassword = watch("changePassword");
  const disableButton = user ? !isDirty || !isValid : !isValid;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAlert, setShowAlert] = useState(false);
  const permissions = watch("permissions") || [];

  const createUser = useCreateUser();
  const updateUser = useUpdateUser();

  const mappedPermissions = (permissions: UserPermission[]) => {
    return permissions
      .filter((perm) => perm.projectIds && perm.projectIds.length > 0)
      .map((perm) => {
        const accountProjectIds = projectsByAccount.get(perm.accountId)?.map((project) => project.id) ?? [];
        if (
          accountProjectIds.length > 0 &&
          perm.projectIds!.length === accountProjectIds.length &&
          accountProjectIds.every((id) => perm.projectIds!.includes(id))
        ) {
          return { ...perm, projectIds: [] };
        }
        return perm;
      });
  };
  const handleOnClose = () => {
    if (isEditMode && isDirty) {
      setShowAlert(true);
    } else {
      reset();
      onClose();
    }
  };

  const handleAccountToggle = (
    accountId: number,
    hasAccountAccess: boolean,
  ) => {
    if (hasAccountAccess) {
      const permissionIndex = permissions.findIndex(
        (permission) => permission.accountId === accountId,
      );
      if (permissionIndex !== -1) remove(permissionIndex);
    } else {
      append({ accountId, projectIds: [] });
    }
  };
  const handleSelectAllProjects = (accountId: number) => {
    const permissionIndex = permissions.findIndex(
      (permission) => permission.accountId === accountId,
    );
    if (permissionIndex === -1) return;
    const projectIds = (projectsByAccount.get(accountId) ?? []).map((project) => project.id);
    update(permissionIndex, { ...permissions[permissionIndex], projectIds });
  };

  const handleUnselectAllProjects = (accountId: number) => {
    const permissionIndex = permissions.findIndex(
      (permission) => permission.accountId === accountId,
    );
    if (permissionIndex === -1) return;
    update(permissionIndex, {
      ...permissions[permissionIndex],
      projectIds: [],
    });
  };

  const handleProjectToggle = (
    accountId: number,
    projectId: number,
    isCurrentlySelected: boolean,
  ) => {
    const permissionIndex = permissions.findIndex(
      (permission) => permission.accountId === accountId,
    );
    if (permissionIndex === -1) return;
    const permission = permissions[permissionIndex];
    const projectIds = isCurrentlySelected ? permission.projectIds.filter((id) => id !== projectId)
      : [...permission.projectIds, projectId];
    update(permissionIndex, { ...permission, projectIds });
  };

  const handleSubmitData = async (formData: UserFormData) => {
    setLoading(true);
    setError(null);
    try {
      // Phase 9: normalize permissions for the backend's existing convention:
      //   - empty projectIds (Unselect-all) → drop the row entirely (no access)
      //   - all projects checked → send projectIds=[] (preserves "full access" semantics)
      //   - subset → send the explicit list
      const normalized = mappedPermissions(permissions);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: any = { ...formData, permissions: normalized };
      // Only send a password when creating, or when the admin explicitly chose to
      // change it — prevents browser-autofilled values from resetting the password.
      if (isEditMode && !(isChangePassword && formData.password)) {
        delete payload.password;
      }
      if (isEditMode) {
        await updateUser.mutateAsync({ id: user.id, data: payload });
        setSnackBar({ msg: "User updated successfully", severity: "success" });
      } else {
        await createUser.mutateAsync(payload);
        setSnackBar({ msg: "User created successfully", severity: "success" });
      }
      onSuccess();
    } catch (err) {
      const errorWithResponse = err as {
        response?: { data?: { error?: string } };
        message?: string;
      };
      setError(
        errorWithResponse?.response?.data?.error || "Failed to save user",
      );
    } finally {
      setSnackBarOpen(true);
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleOnClose} maxWidth="md" fullWidth>
      <DialogTitle>{isEditMode ? "Edit User" : "Create New User"}</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 2,
            mb: 3,
          }}
        >
          <TextField
            label="User Email (ID)"
            {...register("userId")}
            error={!!errors.userId}
            helperText={errors.userId?.message || ""}
            fullWidth
            required
            disabled={isEditMode}
            autoComplete="off"
          />
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 0.5,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center" }}>
              <Typography sx={{ mb: 0.5 }}>Status:</Typography>

              <Controller
                name="isActive"
                control={control}
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onChange={(event) => field.onChange(event.target.checked)}
                    color="success"
                  />
                )}
              />

              <Typography>{isActive ? "Active" : "Inactive"}</Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center" }}>
              <Typography sx={{ mb: 0.5 }}>Claude Usage pilot:</Typography>

              <Controller
                name="claudeUsagePilot"
                control={control}
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onChange={(event) => field.onChange(event.target.checked)}
                    color="success"
                  />
                )}
              />

              <Typography>
                {isClaudeUsagePilot ? "On" : "Off"}
              </Typography>
            </Box>
          </Box>
          <TextField
            label="First Name"
            {...register("firstName")}
            error={!!errors.firstName}
            helperText={errors.firstName?.message || ""}
            fullWidth
            required
          />
          <TextField
            label="Last Name"
            {...register("lastName")}
            error={!!errors.lastName}
            helperText={errors.lastName?.message || ""}
            fullWidth
            required
          />
          <TextField
            label="Email (for notifications)"
            fullWidth
            type="email"
            {...register("email")}
            error={!!errors.email}
            helperText={
              errors.email?.message ||
              "Used by the notification engine to reach this user"
            }
          />
          {isEditMode ?
            <Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={isChangePassword}
                    onChange={(e) => {
                      const isChecked = e.target.checked;
                      setValue("changePassword", isChecked, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });

                      if (!isChecked) {
                        setValue("password", "", {
                          shouldDirty: true,
                          shouldValidate: true,
                        });
                        clearErrors("password");
                      }
                    }}
                  />
                }
                label="Change password"
              />
              {isChangePassword && (
                <TextField
                  label="New Password"
                  type="password"
                  {...register("password")}
                  error={!!errors.password}
                  helperText={errors.password?.message || ""}
                  fullWidth
                  autoComplete="new-password"
                  sx={{ mt: 1 }}
                />
              )}
            </Box>
            : <TextField
              label="Password"
              type="password"
              {...register("password")}
              error={!!errors.password}
              helperText={errors.password?.message || ""}
              fullWidth
              required
              autoComplete="new-password"
            />
          }
          <FormControl fullWidth error={!!errors.roleName}>
            <InputLabel>Role</InputLabel>
            <Controller
              name="roleName"
              control={control}
              render={({ field }) => (
                <Select {...field} label="Role" value={field.value || ""}>
                  {roles.map((role) => (
                    <MenuItem key={role.id} value={role.name}>
                      <Box>
                        <Typography
                          variant="body2"
                          fontWeight={600}
                          sx={{ textTransform: "capitalize" }}
                        >
                          {role.name}
                        </Typography>
                        {role.description && (
                          <Typography variant="caption" color="text.secondary">
                            {role.description}
                          </Typography>
                        )}
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              )}
            />
          </FormControl>
        </Box>

        <Typography variant="h6" sx={{ mt: 3, mb: 2 }}>
          Account & Project Permissions
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Toggle an account to grant access to it. By default, granting account
          access grants access to ALL projects within it. You can expand the
          account to restrict access to specific projects.
        </Typography>
        {accounts.map((account) => {
          const perm = permissions.find(
            (permission) => permission.accountId === account.id,
          );
          const hasAccountAccess = !!perm;
          const accountProjects = projectsByAccount.get(account.id) ?? [];

          // After load-time normalization, projectIds is always an explicit list while editing.
          // Empty array now legitimately means "0 projects selected" (will drop the row on save).
          const selectedCount = hasAccountAccess ? (perm.projectIds?.length ?? 0) : 0;
          const totalCount = accountProjects.length;
          const summaryLabel =
            !hasAccountAccess ? null
              : selectedCount === totalCount ? "(All Projects)"
                : selectedCount === 0 ? "(0 selected — will be removed)"
                  : `(${selectedCount} of ${totalCount})`;

          return (
            <Accordion
              key={account.id}
              disableGutters
              elevation={1}
              sx={{ mb: 1, border: "1px solid #e0e0e0" }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <FormControlLabel
                  onClick={(event) => event.stopPropagation()}
                  onFocus={(event) => event.stopPropagation()}
                  control={
                    <Checkbox
                      checked={hasAccountAccess}
                      onChange={() =>
                        handleAccountToggle(account.id, hasAccountAccess)
                      }
                    />
                  }
                  label={
                    <Typography fontWeight="bold">{account.name}</Typography>
                  }
                />
                {hasAccountAccess && (
                  <Typography
                    variant="body2"
                    color="primary"
                    sx={{ ml: 2, alignSelf: "center" }}
                  >
                    {summaryLabel}
                  </Typography>
                )}
              </AccordionSummary>
              <AccordionDetails sx={{ backgroundColor: "grey.50" }}>
                {accountProjects.length === 0 ?
                  <Typography variant="body2" color="text.secondary">
                    No projects in this account.
                  </Typography>
                  : <>
                    {hasAccountAccess && (
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          mb: 1,
                          ml: 4,
                        }}
                      >
                        <Chip
                          size="small"
                          label={`${selectedCount} of ${totalCount} selected`}
                        />
                        <Box sx={{ flexGrow: 1 }} />
                        <Button
                          size="small"
                          onClick={() => handleSelectAllProjects(account.id)}
                          disabled={selectedCount === totalCount}
                        >
                          Select all
                        </Button>
                        <Button
                          size="small"
                          onClick={() => handleUnselectAllProjects(account.id)}
                          disabled={selectedCount === 0}
                        >
                          Unselect all
                        </Button>
                      </Box>
                    )}
                    {hasAccountAccess && selectedCount === 0 && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ ml: 4, mb: 1, display: "block" }}
                      >
                        Saving with 0 projects selected will remove the account
                        access.
                      </Typography>
                    )}
                    <Box
                      sx={{ display: "flex", flexDirection: "column", ml: 4 }}
                    >
                      {accountProjects.map((project) => {
                        const isSelected =
                          hasAccountAccess &&
                          perm.projectIds?.includes(project.id);
                        return (
                          <FormControlLabel
                            key={project.id}
                            disabled={!hasAccountAccess}
                            control={
                              <Checkbox
                                checked={!!isSelected}
                                onChange={() =>
                                  handleProjectToggle(
                                    account.id,
                                    project.id,
                                    !!isSelected,
                                  )
                                }
                                size="small"
                              />
                            }
                            label={`${project.name} (${project.code})`}
                          />
                        );
                      })}
                    </Box>
                  </>
                }
              </AccordionDetails>
            </Accordion>
          );
        })}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleOnClose}>Cancel</Button>
        <Button
          onClick={handleSubmit(handleSubmitData)}
          variant="contained"
          disabled={loading || disableButton}
        >
          {loading ? "Saving..." : "Save User"}
        </Button>
      </DialogActions>

      {showAlert && (
        <ConfirmationDialog
          title="Unsaved Changes"
          message="You have some unsaved changes, do you want to close it?"
          action="Yes"
          closeButtonText="No"
          ActionButtonColor="primary"
          confirm={onClose}
          setShowAlert={setShowAlert}
          onClose={() => {
            setShowAlert(false);
          }}
        />
      )}
    </Dialog>
  );
};

export default UserModal;
