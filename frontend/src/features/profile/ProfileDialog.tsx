import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Chip,
  Divider,
  Alert,
  CircularProgress,
  IconButton,
  InputAdornment,
  Avatar,
  Card,
  CardContent,
  Collapse,
  Grid,
} from "@mui/material";
import {
  Close as CloseIcon,
  Visibility,
  VisibilityOff,
  LockOutlined,
  PersonOutline,
  BadgeOutlined,
  FolderOutlined,
  SaveOutlined,
  EditOutlined,
  CancelOutlined,
} from "@mui/icons-material";
import { FormControlLabel, Switch, } from '@mui/material';
import { useAuth } from "../../context/AuthContext";
import { useMyProfile, useUpdateMyProfile } from "./hooks";
import type { ProfileData } from "./types";
import { createProfileSchema, type ProfileFormData } from "../admin/users/userValidationSchema";

interface ProfileDialogProps {
  open: boolean;
  onClose: () => void;
  setSuccess: (message: string | null) => void;
  setSnackbarOpen: (open: boolean) => void;
}

const NAVY = "#002e5b";

const roleColor = (roleName: string): string => {
  switch ((roleName || '').toLowerCase()) {
    case 'superuser': return '#7c3aed';
    case 'admin': return '#dc2626';
    case 'manager': return '#0891b2';
    case 'lead': return '#f59e0b';
    case 'member': return '#10b981';
    default: return '#6b7280';
  }
};

/**
 * Self-service profile dialog. Lets any authenticated user view their assignments
 * (read-only) and update their first name, last name, and password.
 *
 * Account / project / role assignment edits remain admin-only and are intentionally
 * displayed without editors.
 */
export const ProfileDialog = ({ open, onClose, setSuccess, setSnackbarOpen }: ProfileDialogProps) => {
  const { updateUser } = useAuth();
  const profileQuery = useMyProfile(open);
  const updateMutation = useUpdateMyProfile();
  const profile: ProfileData | undefined = profileQuery.data;
  const loading = profileQuery.isLoading;
  const saving = updateMutation.isPending;
  const [showCurPassword, setShowCurPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const queryError = profileQuery.isError ? (
    profileQuery.error as { response?: { data?: { error?: string } }; })?.response?.data?.error || "Failed to load profile"
    : null;

  const displayError = error || queryError;

  const profileSchema = createProfileSchema();

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    formState: { errors, isDirty, isValid },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    values: {
      firstName: profile?.firstName ?? "",
      lastName: profile?.lastName ?? "",
      changePassword: false,
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const newPassword = useWatch({ control, name: "newPassword" }) || "";
  const confirmPassword = useWatch({ control, name: "confirmPassword" }) || "";
  const changePassword = useWatch({ control, name: "changePassword" }) ?? false;

  const resetProfileForm = () => {
    if (profile) {
      reset({
        firstName: profile.firstName,
        lastName: profile.lastName,
        changePassword: false,
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
    }
    setEditingProfile(false);
    setError(null);
  };

  const handlePasswordToggle = (event: React.ChangeEvent<HTMLInputElement>) => {
    const checked = event.target.checked;
    setValue("changePassword", checked, { shouldDirty: true, shouldValidate: true, });

    if (!checked) {
      setValue("currentPassword", "");
      setValue("newPassword", "");
      setValue("confirmPassword", "");
    }
  };

  const handleSave = async (data: ProfileFormData) => {
    setError(null);
    setSuccess(null);

    const payload: {
      firstName?: string;
      lastName?: string;
      currentPassword?: string;
      newPassword?: string;
    } = {};

    if (profile) {
      if (data.firstName.trim() !== profile.firstName) {
        payload.firstName = data.firstName.trim();
      }

      if (data.lastName.trim() !== profile.lastName) {
        payload.lastName = data.lastName.trim();
      }
    }

    if (changePassword) {
      payload.currentPassword = data.currentPassword;
      payload.newPassword = data.newPassword;
    }

    if (Object.keys(payload).length === 0) {
      return;
    }

    try {
      const updated = await updateMutation.mutateAsync(payload);

      updateUser({
        firstName: updated.firstName,
        lastName: updated.lastName,
        password: updated.password,
      });

      reset({
        firstName: updated.firstName,
        lastName: updated.lastName,
        changePassword: false,
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });

      setSuccess(payload.newPassword ? "Profile and password updated successfully." : "Profile updated successfully.");
      setEditingProfile(false);
      setSnackbarOpen(true);
      onClose();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; }; }; };
      setError(e?.response?.data?.error || "Failed to update profile");
    }
  };

  const handleClose = () => {
    setEditingProfile(false);

    if (profile) {
      resetProfileForm();
    }
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 4, }, }}>
      <DialogTitle
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          pb: 1.5,
        }}
      >
        <Box>
          <Typography sx={{ fontWeight: 700, color: NAVY, fontSize: 20, }}>My Profile</Typography>
          <Typography variant="body2" color="text.secondary">
            Manage your personal information
          </Typography>
        </Box>

        <IconButton size="small" onClick={handleClose} disabled={saving}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {displayError && (
          <Alert
            severity="error"
            onClose={error ? () => setError(null) : undefined}
          >
            {displayError}
          </Alert>
        )}

        {loading && (
          <Box sx={{ py: 5, display: "flex", justifyContent: "center", }} >
            <CircularProgress size={28} />
          </Box>
        )}

        {!loading && profile && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {/* Profile Summary */}
            <Card elevation={0} sx={{ border: "1px solid #e5e7eb", borderRadius: 2, }} >
              <CardContent>
                <Box sx={{ display: "flex", alignItems: "center", gap: 2, }}>
                  <Avatar
                    sx={{
                      width: 60,
                      height: 60,
                      bgcolor: NAVY,
                      fontWeight: 700,
                      fontSize: 22,
                    }}
                  >
                    {profile.firstName.charAt(0)}
                    {profile.lastName.charAt(0)}
                  </Avatar>

                  <Box sx={{ flex: 1 }}>
                    <Grid direction="row" container>
                      <Typography sx={{ fontWeight: 700, fontSize: 18 }}>
                        {profile.firstName} {profile.lastName}
                      </Typography>

                      {!editingProfile ? (
                        <IconButton onClick={() => setEditingProfile(true)} size="small" sx={{ pt: 0 }}>
                          <EditOutlined />
                        </IconButton>
                      ) : (
                        <IconButton size="small" onClick={handleClose} disabled={saving} sx={{ pt: 0 }}>
                          <CancelOutlined />
                        </IconButton>
                      )}
                    </Grid>

                    <Typography variant="body2" color="text.secondary">
                      {profile.userId}
                    </Typography>

                    <Chip
                      label={profile.roleName}
                      size="small"
                      sx={{
                        mt: 1,
                        bgcolor: `${roleColor(profile.roleName)}15`,
                        color: roleColor(profile.roleName),
                        border: `1px solid ${roleColor(profile.roleName)}50`,
                        fontWeight: 700,
                      }}
                    />
                  </Box>
                </Box>
              </CardContent>
            </Card>

            {/* Editable Section */}
            <Card elevation={0} sx={{ border: "1px solid #e5e7eb", borderRadius: 2, }} >
              <CardContent>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    mb: 2,
                  }}
                >
                  <PersonOutline sx={{ color: NAVY, fontSize: 20, }} />
                  <Typography sx={{ fontWeight: 700, color: NAVY, }}>Editable Information</Typography>
                </Box>

                {editingProfile && (
                  <Collapse in={editingProfile}>
                    <Divider sx={{ my: 2 }} />

                    <Grid container spacing={2}>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                          label="First Name"
                          {...register("firstName")}
                          fullWidth
                          size="small"
                          error={!!errors.firstName}
                          helperText={errors.firstName?.message}
                        />
                      </Grid>

                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                          label="Last Name"
                          {...register("lastName")}
                          fullWidth
                          size="small"
                          error={!!errors.lastName}
                          helperText={errors.lastName?.message}
                        />
                      </Grid>
                    </Grid>
                  </Collapse>
                )}

                <Divider sx={{ my: 3 }} />

                <Box sx={{ mt: 3 }}>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      mb: 2,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <LockOutlined sx={{ color: NAVY }} />
                      <Typography sx={{ fontWeight: 700, color: NAVY, }} > Change Password</Typography>
                    </Box>

                    <FormControlLabel
                      control={
                        <Switch
                          checked={changePassword}
                          onChange={handlePasswordToggle}
                          color="primary"
                        />
                      }
                      label=""
                    />
                  </Box>

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Enable this option if you'd like to update your password.
                  </Typography>

                  {changePassword && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, }}>
                      <TextField
                        label="Current Password"
                        type={showCurPassword ? "text" : "password"}
                        {...register("currentPassword")}
                        fullWidth
                        size="small"
                        disabled={saving}
                        error={!!errors.currentPassword}
                        helperText={errors.currentPassword?.message}
                        InputProps={{
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton size="small" onClick={() => setShowCurPassword((v) => !v)}>
                                {showCurPassword ? (<VisibilityOff fontSize="small" />) : (<Visibility fontSize="small" />)}
                              </IconButton>
                            </InputAdornment>
                          ),
                        }}
                      />

                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: {
                            xs: '1fr',
                            sm: '1fr 1fr',
                          },
                          gap: 2,
                        }}
                      >
                        <TextField
                          label="New Password"
                          type={showNewPassword ? "text" : "password"}
                          {...register("newPassword")}
                          fullWidth
                          size="small"
                          disabled={saving}
                          error={!!errors.newPassword}
                          helperText={
                            errors.newPassword?.message ||
                            (newPassword.length > 0
                              ? newPassword.length >= 6
                                ? "✓ Password length looks good"
                                : "Minimum 6 characters"
                              : " ")
                          }
                          InputProps={{
                            endAdornment: (
                              <InputAdornment position="end">
                                <IconButton size="small" onClick={() => setShowNewPassword((v) => !v)}>
                                  {showNewPassword ? (<VisibilityOff fontSize="small" />) : (<Visibility fontSize="small" />)}
                                </IconButton>
                              </InputAdornment>
                            ),
                          }}
                        />

                        <TextField
                          label="Confirm Password"
                          type={showConfirmPassword ? "text" : "password"}
                          {...register("confirmPassword")}
                          fullWidth
                          size="small"
                          disabled={saving}
                          error={!!errors.confirmPassword}
                          helperText={
                            errors.confirmPassword?.message ||
                            (confirmPassword
                              ? newPassword === confirmPassword
                                ? "✓ Passwords match"
                                : "Passwords do not match"
                              : " ")
                          }
                          InputProps={{
                            endAdornment: (
                              <InputAdornment position="end">
                                <IconButton size="small" onClick={() => setShowConfirmPassword((v) => !v)}>
                                  {showConfirmPassword ? (<VisibilityOff fontSize="small" />) : (<Visibility fontSize="small" />)}
                                </IconButton>
                              </InputAdornment>
                            ),
                          }}
                        />
                      </Box>
                    </Box>
                  )}
                </Box>
              </CardContent>
            </Card>

            {/* Read Only Section */}
            <Card elevation={0} sx={{ border: "1px solid #e5e7eb", borderRadius: 2, }}>
              <CardContent>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2, }}  >
                  <BadgeOutlined sx={{ color: NAVY, fontSize: 20, }} />
                  <Typography sx={{ fontWeight: 700, color: NAVY, }}>Account Information</Typography>
                </Box>

                <Box sx={{ display: "flex", gap: 2, mb: 3, }}>
                  <TextField
                    label="User ID"
                    value={profile.userId}
                    fullWidth
                    size="small"
                    disabled
                    InputProps={{
                      readOnly: true,
                    }}
                  />

                  <TextField
                    label="Role"
                    value={profile.roleName}
                    fullWidth
                    size="small"
                    disabled
                    InputProps={{
                      readOnly: true,
                    }}
                  />
                </Box>
                {profile.roleName !== 'superuser' && (
                  <>
                    <Divider sx={{ mb: 3 }} />

                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2, }}>
                      <FolderOutlined sx={{ color: NAVY, fontSize: 20, }} />
                      <Typography sx={{ fontWeight: 700, color: NAVY, }} >
                        Account, Project & Program Assignments
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, }} >
                      {profile.accounts.length === 0 ?
                        <Box
                          sx={{
                            p: 3,
                            borderRadius: 2,
                            bgcolor: "#f9fafb",
                            border: "1px dashed #d1d5db",
                            textAlign: "center",
                          }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            📁 No account assignments yet
                          </Typography>
                        </Box>
                        : <Box sx={{ display: "flex", flexDirection: "column", gap: 2, }} >
                          <Card elevation={0} sx={{ border: "1px solid #e5e7eb", borderRadius: 2, }}>
                            <CardContent>
                              <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 1, }}  >
                                <Typography sx={{ fontWeight: 700, color: NAVY, }} > Accounts Project </Typography>
                                {profile.accounts.map((acct) => (
                                  <Card
                                    key={acct.id}
                                    elevation={0}
                                    sx={{
                                      border: "1px solid #e5e7eb",
                                      borderRadius: 2,
                                      bgcolor: "#fafafa",
                                    }}
                                  >
                                    <CardContent sx={{ py: 2 }}>
                                      <Box
                                        sx={{
                                          display: "flex",
                                          justifyContent: "space-between",
                                          alignItems: "center",
                                          mb: 1.5,
                                        }}
                                      >
                                        <Typography sx={{ fontWeight: 700, color: NAVY, }} > {acct.name} </Typography>
                                        <Chip
                                          label={acct.name}
                                          size="small"
                                          color="primary"
                                          variant="outlined"
                                        />
                                      </Box>

                                      {acct.projects.length === 0 ?
                                        <Typography variant="body2" color="text.secondary">No projects assigned</Typography>
                                        : <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, }}>
                                          {acct.projects.map((project) => (
                                            <Chip
                                              key={project.id}
                                              label={project.name}
                                              title={project.name}
                                              variant="outlined"
                                              size="small"
                                              sx={{
                                                borderRadius: 1,
                                                fontWeight: 500,
                                              }}
                                            />
                                          ))}
                                        </Box>
                                      }
                                    </CardContent>
                                  </Card>
                                ))}
                              </Box>
                            </CardContent>
                          </Card>
                        </Box>
                      }
                      {profile.programs.length === 0 ?
                        <Box
                          sx={{
                            p: 3,
                            borderRadius: 2,
                            bgcolor: "#f9fafb",
                            border: "1px dashed #d1d5db",
                            textAlign: "center",
                          }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            📁 No program assignments yet
                          </Typography>
                        </Box>
                        : <Box sx={{ display: "flex", flexDirection: "column", gap: 2, }} >
                          <Card elevation={0} sx={{ border: "1px solid #e5e7eb", borderRadius: 2, }}>
                            <CardContent>
                              <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 1, }}  >
                                <Typography sx={{ fontWeight: 700, color: NAVY, }} > Programs Project </Typography>
                                {profile.programs.map((program) => (
                                  <Card
                                    key={program.id}
                                    elevation={0}
                                    sx={{
                                      border: "1px solid #e5e7eb",
                                      borderRadius: 2,
                                      bgcolor: "#fafafa",
                                    }}
                                  >
                                    <CardContent sx={{ py: 2 }}>
                                      <Box
                                        sx={{
                                          display: "flex",
                                          justifyContent: "space-between",
                                          alignItems: "center",
                                          mb: 1.5,
                                        }}
                                      >
                                        <Typography sx={{ fontWeight: 700, color: NAVY, }} > {program.name} </Typography>
                                        <Chip
                                          label={program.name}
                                          size="small"
                                          color="primary"
                                          variant="outlined"
                                        />
                                      </Box>

                                      {program.projects.length === 0 ?
                                        <Typography variant="body2" color="text.secondary">No projects assigned</Typography>
                                        : <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, }}>
                                          {program.projects.map((project) => (
                                            <Chip
                                              key={project.id}
                                              label={project.name}
                                              title={project.name}
                                              variant="outlined"
                                              size="small"
                                              sx={{
                                                borderRadius: 1,
                                                fontWeight: 500,
                                              }}
                                            />
                                          ))}
                                        </Box>
                                      }
                                    </CardContent>
                                  </Card>
                                ))}
                              </Box>
                            </CardContent>
                          </Card>
                        </Box>
                      }
                    </Box>
                  </>
                )}
              </CardContent>
            </Card>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, }}>
        <Button onClick={handleClose} disabled={saving}>Cancel</Button>

        <Button
          variant="contained"
          startIcon={!saving ? <SaveOutlined /> : undefined}
          onClick={handleSubmit(handleSave)}
          disabled={saving || loading || !profile || !isDirty || !isValid
          }
          sx={{
            bgcolor: NAVY,
            px: 3,
            "&:hover": {
              bgcolor: "#001f3f",
            },
          }}
        >
          {saving ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Save Changes"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
