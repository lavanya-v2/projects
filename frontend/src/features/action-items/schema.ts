import dayjs from "dayjs";
import { z } from "zod";

export type ActionItemTab = "account-items" | "project-items" | "program-items";

const dueDateSchema = z
  .string()
  .optional()
  .superRefine((value, ctx) => {
    if (!value) return;

    const dueDate = dayjs(value);
    const today = dayjs().startOf("day");
    const maxDate = dayjs().add(3, "month").endOf("day");

    if (dueDate.isAfter(maxDate)) {
      ctx.addIssue({
        code: "custom",
        message: "Due date should be within 3 months",
      });
    }

    if (dueDate.isBefore(today)) {
      ctx.addIssue({
        code: "custom",
        message: "Due date cannot be past date",
      });
    }
  });

const commonFields = {
  title: z.string().trim().min(1, "Title is required."),
  category: z.string().min(1, "Category is required."),
  owner: z.string().trim().min(1, "Owner is required."),
  dueDate: dueDateSchema,
};

const accountActionItemSchema = z.object({
  tab: z.literal("account-items"),
  accountId: z.string().min(1, "Account is required."),
  ...commonFields,
});

const projectActionItemSchema = z.object({
  tab: z.literal("project-items"),
  accountId: z.string().min(1, "Account is required."),
  projectId: z.string().min(1, "Project is required."),
  ...commonFields,
});

const programActionItemSchema = z.object({
  tab: z.literal("program-items"),
  accountId: z.string().min(1, "Account is required."),
  programId: z.string().min(1, "Program is required."),
  ...commonFields,
});

export const actionItemSchema = z.discriminatedUnion("tab", [
  accountActionItemSchema,
  projectActionItemSchema,
  programActionItemSchema,
]);

export type ActionItemFormValues = z.infer<typeof actionItemSchema>;
