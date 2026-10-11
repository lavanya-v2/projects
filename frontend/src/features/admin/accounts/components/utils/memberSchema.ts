import z from "zod";
import { EMAIL_REGEX, NAME_REGEX } from "../../../../../shared/utils/regexExpression";

export const memberSchema = z.object({
  firstName: z
    .string()
    .min(1, { message: "First name is required" })
    .regex(NAME_REGEX, {
      message:
        "Must start and end with a letter and contain only letters or spaces",
    }),
  lastName: z
    .string()
    .min(1, { message: "Last name is required" })
    .regex(NAME_REGEX, {
      message:
        "Must start and end with a letter and contain only letters or spaces",
    }),
  email: z
    .string()
    .min(1, { message: "Email is required" })
    .regex(EMAIL_REGEX, {
      message: "Invalid email format",
    }),
  jiraLoginId: z
    .string()
    .min(1, { message: "Jira Login Id is required" })
    .regex(EMAIL_REGEX, {
      message: "Invalid jira login id format.",
    }),
  partnerEmailId: z
    .string()
    .regex(EMAIL_REGEX, {
      message: "Invalid Partner Email Id format.",
    })
    .or(z.literal("")),
});

export const existingMemberSchema = z.object({
  linkedMember: z
    .object()
    .nullable()
    .refine((val) => val !== null, {
      message: "Please select an existing team member",
    }),
});