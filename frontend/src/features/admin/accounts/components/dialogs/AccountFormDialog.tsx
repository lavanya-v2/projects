import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
} from "@mui/material";
import { useAdminCreateAccount, useAdminUpdateAccount } from "../../hooks";
import type { Account } from "../../types";
import {
  closeOnEscapeOnly,
  DialogCloseButton,
} from "../../../../../shared/components/dialogHelpers";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
import { NAME_REGEX } from "../../../../../shared/utils/regexExpression";

interface AccountForm {
  name: string;
  code: string;
  description?: string;
  amberThresholdPercentage: number;
  redThresholdPercentage: number;
  redProjectCountFloor: number;
  // Kept as a string in form state (not number | null) because MUI's TextField only speaks
  // strings -- empty string means "off", any other value is parsed to a number on save.
  redCeilingBadPercentage: string;
  // JS Date.getDay() convention: 0=Sun...6=Sat. Default 5 (Friday) matches every account's
  // current behavior until explicitly changed.
  weekStartDay: number;
}

const DAY_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

const emptyForm = (): AccountForm => ({
  name: "",
  code: "",
  description: "",
  amberThresholdPercentage: 20,
  redThresholdPercentage: 30,
  redProjectCountFloor: 2,
  redCeilingBadPercentage: '',
  weekStartDay: 5,
});

const formFromAccount = (acc: Account): AccountForm => ({
  name: acc.name,
  code: acc.code,
  description: acc.description || "",
  amberThresholdPercentage: acc.amberThresholdPercentage,
  redThresholdPercentage: acc.redThresholdPercentage,
  redProjectCountFloor: acc.redProjectCountFloor,
  redCeilingBadPercentage: acc.redCeilingBadPercentage == null ? '' : String(acc.redCeilingBadPercentage),
  weekStartDay: acc.weekStartDay,
});

interface AccountFormDialogProps {
  open: boolean;
  editing: Account | null;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

const percentageSchema = z
  .number({message: "Must be a number"})
  .min(0, { message: "Percentage should be between 0 and 100" })
  .max(100, { message: "Percentage should be between 0 and 100" });

const formSchema = z.object({
  name: z.string().min(1, { message: "Name is required" }).regex(NAME_REGEX, {
    message: "Numbers are not allowed in this field",
  }),
  code: z.string().min(1, { message: "Code is required" }),
  description: z.string().optional().or(z.literal("")),
  amberThresholdPercentage: percentageSchema,
  redThresholdPercentage: percentageSchema,
  redProjectCountFloor: z
    .number({ message: "Must be a number" })
    .int({ message: "Must be a whole number" })
    .min(1, { message: "Must be at least 1" }),
  // Empty string means "off" (the ceiling is optional) -- any other value must be a real 0-100 percentage.
  redCeilingBadPercentage: z.string().refine(
    val => val === "" || (!isNaN(Number(val)) && Number(val) >= 0 && Number(val) <= 100),
    { message: "Percentage should be between 0 and 100, or blank to disable" }
  ),
  weekStartDay: z.number().int().min(0).max(6),
});

/** Create or edit an account. Owns its own form state. */
export const AccountFormDialog = ({
  open,
  editing,
  onClose,
  onSuccess,
  onError,
}: AccountFormDialogProps) => {
  const createAccount = useAdminCreateAccount();
  const updateAccount = useAdminUpdateAccount();
  const [saving, setSaving] = useState(false);
  const form = editing ? formFromAccount(editing) : emptyForm();

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isValid },
  } = useForm<AccountForm>({
    defaultValues: form,
    resolver: zodResolver(formSchema),
    mode: "onChange",
  });

  const handleSave = async (data: AccountForm) => {
    setSaving(true);
    try {
      // `data` is react-hook-form's live, current field values -- not the stale `form` default
      // computed once at render. Using `form` here would silently save whatever the fields
      // started with, ignoring anything the user actually typed.
      const payload = {
        ...data,
        redCeilingBadPercentage: data.redCeilingBadPercentage === "" ? null : Number(data.redCeilingBadPercentage),
      };
      if (editing) {
        await updateAccount.mutateAsync({ id: editing.id, data: payload });
        onSuccess("Account updated");
      } else {
        await createAccount.mutateAsync(payload);
        onSuccess("Account created");
        reset();
      }
      onClose();
    } catch (err) {
      const errorWithResponse = err as {
        response?: { data?: { message?: string } };
      };
      onError(errorWithResponse.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleOnClose = () => {
    reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={closeOnEscapeOnly(handleOnClose)}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle sx={{ pr: 6 }}>
        {editing ? "Edit Account" : "New Account"}
        <DialogCloseButton onClick={handleOnClose} />
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "grid", gap: 2, pt: 1 }}>
          <TextField
            label="Name"
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
            {...register("code")}
            error={!!errors.code}
            helperText={
              errors.code?.message || "Short unique identifier (e.g. CCMH)"
            }
          />
          <TextField
            label="Description"
            fullWidth
            multiline
            rows={2}
            {...register("description")}
            error={!!errors.description}
            helperText={errors.description?.message || ""}
          />
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              label="Amber Threshold %"
              type="number"
              fullWidth
              {...register("amberThresholdPercentage", { valueAsNumber: true })}
              error={!!errors.amberThresholdPercentage}
              helperText={errors.amberThresholdPercentage?.message || ""}
            />
            <TextField
              label="Red Threshold %"
              type="number"
              fullWidth
              {...register("redThresholdPercentage", { valueAsNumber: true })}
              error={!!errors.redThresholdPercentage}
              helperText={errors.redThresholdPercentage?.message || ""}
            />
          </Box>
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              label="Red Count Floor"
              type="number"
              fullWidth
              {...register("redProjectCountFloor", { valueAsNumber: true })}
              error={!!errors.redProjectCountFloor}
              helperText={errors.redProjectCountFloor?.message || "Escalate to Red once this many projects are individually Red"}
            />
            <TextField
              label="Red Ceiling %"
              type="number"
              fullWidth
              {...register("redCeilingBadPercentage")}
              error={!!errors.redCeilingBadPercentage}
              helperText={errors.redCeilingBadPercentage?.message || "Optional: escalate to Red once Red+Amber % reaches this. Leave blank to disable."}
            />
          </Box>
          <FormControl fullWidth>
            <InputLabel id="week-start-day-label">Week Starts On</InputLabel>
            <Controller
              name="weekStartDay"
              control={control}
              render={({ field }) => (
                <Select
                  {...field}
                  labelId="week-start-day-label"
                  label="Week Starts On"
                >
                  {DAY_OPTIONS.map(d => (
                    <MenuItem key={d.value} value={d.value}>{d.label}</MenuItem>
                  ))}
                </Select>
              )}
            />
            <FormHelperText>
              The weekly report cycle for this account (e.g. Friday means Friday–Thursday). Changing this affects when the weekly cron generates reports and which dates are valid to select.
            </FormHelperText>
          </FormControl>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleOnClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit(handleSave)}
          disabled={saving || !isValid}
        >
          {saving ? <CircularProgress size={18} /> : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
