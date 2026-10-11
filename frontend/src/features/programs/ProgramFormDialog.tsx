import React, { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  Box,
  Typography,
  Alert,
} from "@mui/material";
import { useCreateProgram, useUpdateProgram } from "./hooks";
import type { Program } from "./types";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  accounts: Array<{
    id: number;
    name: string;
    redThresholdPercentage?: number;
  }>;
  editing: Program | null;
  defaultAccountId?: number;
}

interface FormInput {
  accountId?: string | "";
  name: string;
  description?: string;
  redThresholdPercentage?: number | null;
}

const programSchema = z.object({
  accountId: z.string().optional(),
  name: z.string().min(1, { message: "Program name is required" }),
  description: z.string().optional(),
  redThresholdPercentage: z
    .union([z.number({message: "Must be a number"}), z.null()])
    .optional()
    .refine(
      (val) => !isNaN(Number(val)) && Number(val) >= 0 && Number(val) <= 100,
      { message: "Must be a number between 0 and 100" },
    ),
});

export const ProgramFormDialog: React.FC<Props> = ({
  open,
  onClose,
  onSuccess,
  accounts,
  editing,
  defaultAccountId,
}) => {
  const isEdit = !!editing;
  const [error, setError] = useState("");
  const create = useCreateProgram();
  const update = useUpdateProgram();
  const saving = create.isPending || update.isPending;

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors },
  } = useForm<FormInput>({
    mode: "onChange",
    values: {
      accountId:
        editing?.accountId || defaultAccountId
          ? String(editing?.accountId ?? defaultAccountId)
          : "",
      name: editing?.name ?? "",
      description: editing?.description ?? "",
      redThresholdPercentage: editing?.redThresholdPercentage ?? null,
    },
    resolver: zodResolver(programSchema),
  });

  const accountThreshold =
    watch("accountId") !== ""
      ? accounts.find((a) => Number(a.id) === Number(watch("accountId")))
          ?.redThresholdPercentage
      : undefined;

  const handleSave = async (data: FormInput) => {
    const threshold =
      data.redThresholdPercentage === null
        ? null
        : Number(data.redThresholdPercentage);

    try {
      if (isEdit) {
        await update.mutateAsync({
          programId: editing!.id,
          input: {
            name: data.name.trim(),
            description: data.description,
            redThresholdPercentage: threshold,
          },
        });
      } else {
        await create.mutateAsync({
          accountId: Number(data.accountId),
          name: data.name.trim(),
          description: data.description,
          redThresholdPercentage: threshold,
        });
      }
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to save program");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? "Edit Program" : "Create Program"}</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Controller
            name="accountId"
            control={control}
            render={({ field }) => (
              <TextField
                select
                label="Account"
                required
                disabled={isEdit}
                value={field.value ? field.value : defaultAccountId}
                fullWidth
                {...register("accountId")}
                error={!!errors.accountId}
                helperText={errors.accountId?.message || ""}
              >
                {accounts.map((a) => (
                  <MenuItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />
          <TextField
            label="Program Name"
            required
            fullWidth
            {...register("name")}
            error={!!errors.name}
            helperText={errors.name?.message || ""}
          />
          <TextField
            label="Description"
            multiline
            rows={2}
            fullWidth
            {...register("description")}
            error={!!errors.description}
            helperText={errors.description?.message || ""}
          />
          <TextField
            label="Red Threshold % (override)"
            inputProps={{ min: 0, max: 100 }} 
            {...register("redThresholdPercentage", { valueAsNumber: true})}
            error={!!errors.redThresholdPercentage}
            helperText={
              errors.redThresholdPercentage?.message ||
              (accountThreshold !== undefined
                ? `Leave blank to use account default (${accountThreshold}%)`
                : "Leave blank to use account default (typically 30%)")
            }
            fullWidth
          />
          {!isEdit && (
            <Typography variant="caption" color="text.secondary">
              You can assign projects to this program after it is created.
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={handleSubmit(handleSave)}
          variant="contained"
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
