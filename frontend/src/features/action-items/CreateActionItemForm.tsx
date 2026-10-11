import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  useMediaQuery,
  useTheme,
} from "@mui/material";

import AddIcon from "@mui/icons-material/Add";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import dayjs from "dayjs";
import { DatePicker, LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import type { Account } from "../admin/accounts/types";
import type { Project } from "../auth/types";
import { ACTION_ITEM_CATEGORIES } from "./ActionItemDetailModal";
import { type ActionItemTab, type ActionItemFormValues, actionItemSchema } from "./schema";


interface Props {
  accounts: Account[];
  selectedAccount?: string;
  tab: ActionItemTab;
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
  handleCreate: (data: ActionItemFormValues) => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actionItem: any;
  createDialogList: {
    id: number;
    name: string;
  }[];
}

export const CreateActionItemForm = ({
  tab,
  accounts,
  selectedAccount,
  createOpen,
  setCreateOpen,
  actionItem,
  handleCreate,
  createDialogList,
}: Props) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const {
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ActionItemFormValues>({
    resolver: zodResolver(actionItemSchema),

    values: {
      tab,
      accountId: selectedAccount ? String(selectedAccount) : "",
      projectId: "",
      programId: "",
      title: "",
      category: "Task",
      owner: "",
      dueDate: "",
    },
  });
  const projectError = "projectId" in errors ? errors.projectId : undefined;
  const programError = "programId" in errors ? errors.programId : undefined;

  const accountId = watch("accountId");
  const accountName = accounts.find((acc) => acc.id === Number(accountId))?.name;

  const title = tab === "project-items" ? "Project" : tab === "program-items" ? "Program" : "Account";

  const handleClose = () => {
    reset();
    setCreateOpen(false);
  };

  const onSubmit = async (data: ActionItemFormValues) => {
    await handleCreate(data);

    reset();
  };

  return (
    <Dialog
      open={createOpen}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      fullScreen={isMobile}
    >
      <DialogTitle>New {title} Action Item</DialogTitle>

      <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <DialogContent>
          {actionItem?.isError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {actionItem?.error?.message || "Failed to create action item"}
            </Alert>
          )}

          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              mt: 1,
            }}
          >
            {/* Account */}
            <Controller
              name="accountId"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  value={accountName}
                  fullWidth
                  label="Account *"
                  slotProps={{
                    input: {
                      readOnly: true,
                      disabled: true
                    },
                  }}
                  error={!!errors.accountId}
                  helperText={errors.accountId?.message}
                >
                </TextField>
              )}
            />

            {/* Project */}
            {tab === "project-items" && (
              <Controller
                name="projectId"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    select
                    fullWidth
                    label="Project *"
                    disabled={!accountId}
                    error={!!projectError}
                    helperText={
                      projectError?.message ||
                      (!accountId ? "Pick an account first" : "")
                    }
                  >
                    {(createDialogList as Project[]).map((project) => (
                      <MenuItem key={project.id} value={String(project.id)}>
                        {project.name}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            )}

            {/* Program */}
            {tab === "program-items" && (
              <Controller
                name="programId"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    select
                    fullWidth
                    label="Program *"
                    disabled={!accountId}
                    error={!!programError}
                    helperText={
                      programError?.message ||
                      (!accountId ? "Pick an account first" : "")
                    }
                  >
                    {(
                      createDialogList as {
                        id: number;
                        name: string;
                      }[]
                    ).map((program) => (
                      <MenuItem key={program.id} value={String(program.id)}>
                        {program.name}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            )}

            {/* Title */}
            <Controller
              name="title"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  fullWidth
                  label="Title *"
                  error={!!errors.title}
                  helperText={errors.title?.message}
                />
              )}
            />

            {/* Category */}
            <Controller
              name="category"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  select
                  fullWidth
                  label="Category *"
                  error={!!errors.category}
                  helperText={errors.category?.message}
                >
                  {ACTION_ITEM_CATEGORIES.map((category) => (
                    <MenuItem key={category} value={category}>
                      {category}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />

            {/* Owner */}
            <Controller
              name="owner"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  fullWidth
                  label="Owner *"
                  error={!!errors.owner}
                  helperText={
                    errors.owner?.message ||
                    "Can be any name, not limited to team members"
                  }
                />
              )}
            />

            {/* Due Date */}
            <Controller
              name="dueDate"
              control={control}
              render={({ field }) => (
                <LocalizationProvider dateAdapter={AdapterDayjs}>
                  <DatePicker
                    label="Due Date"
                    value={field.value ? dayjs(field.value) : null}
                    onChange={(date) => {
                      field.onChange(date ? date.toISOString() : "");
                    }}
                    minDate={dayjs()}
                    maxDate={dayjs().add(3, "month")}
                    views={["year", "month", "day"]}
                    slotProps={{
                      textField: {
                        fullWidth: true,
                        error: !!errors.dueDate,
                        helperText: errors.dueDate?.message,
                      },
                    }}
                  />
                </LocalizationProvider>
              )}
            />
          </Box>
        </DialogContent>

        <DialogActions>
          <Button onClick={handleClose} disabled={actionItem?.isPending}>
            Cancel
          </Button>

          <Button
            type="submit"
            variant="contained"
            disabled={actionItem?.isPending || isSubmitting}
            startIcon={
              actionItem?.isPending || isSubmitting ? (
                <CircularProgress size={14} />
              ) : (
                <AddIcon />
              )
            }
          >
            Create
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
};
