import { z } from "zod";
import { NAME_REGEX } from "../../../shared/utils/regexExpression";

export const createProfileSchema = () =>
  z
    .object({
      firstName: z
        .string()
        .trim()
        .min(1, "First name is required")
        .max(50, "First name cannot exceed 50 characters")
        .regex(NAME_REGEX, "First Name must only contain letters"),

      lastName: z
        .string()
        .trim()
        .min(1, "Last name is required")
        .max(50, "Last name cannot exceed 50 characters")
        .regex(NAME_REGEX, "Last Name must only contain letters"),

      currentPassword: z.string(),
      newPassword: z.string(),
      confirmPassword: z.string(),
      changePassword: z.boolean(),
    })
    .superRefine((data, ctx) => {
      // Password validation is only required when
      // the user has enabled "Change Password".
      if (!data.changePassword) {
        return;
      }

      if (!data.currentPassword.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["currentPassword"],
          message: "Current password is required",
        });
      }

      if (!data.newPassword.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["newPassword"],
          message: "New password is required",
        });
      } else if (data.newPassword.length < 6) {
        ctx.addIssue({
          code: "custom",
          path: ["newPassword"],
          message: "New password must be at least 6 characters",
        });
      } else if (data.newPassword.length > 128) {
        ctx.addIssue({
          code: "custom",
          path: ["newPassword"],
          message: "New password cannot exceed 128 characters",
        });
      }

      if (
        data.currentPassword &&
        data.newPassword &&
        data.currentPassword === data.newPassword
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["newPassword"],
          message: "New password must be different from current password",
        });
      }

      if (!data.confirmPassword.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["confirmPassword"],
          message: "Please confirm your new password",
        });
      } else if (data.newPassword !== data.confirmPassword) {
        ctx.addIssue({
          code: "custom",
          path: ["confirmPassword"],
          message: "Passwords do not match",
        });
      }
    });

export type ProfileFormData = z.infer<ReturnType<typeof createProfileSchema>>;
