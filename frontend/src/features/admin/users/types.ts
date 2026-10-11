import type { Project } from "../../auth/types";
import type { Account } from "../accounts/types";

export interface UserPermission {
  accountId: number;
  projectIds: number[];
  programId?: number | null;
}

export interface User {
  id: number;
  userId: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  roleName: string;
  isActive: boolean;
  accounts?: string;
  projects?: string;
  permissions?: UserPermission[];
  password?: string;
  claudeUsagePilot?: boolean;
}

export interface Role {
  id: number;
  name: string;
  description: string;
}
export interface UsersApiResponse {
  success: boolean;
  data: User[];
  totalItems?: number;
}

export interface UserModalProps {
  accounts: Account[];
  projects: Project[];
  roles: Role[];
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  user: User | null;
  setSnackBar: (
    value: {
      msg: string;
      severity: "success" | "error";
    } | null,
  ) => void;
  setSnackBarOpen: (open: boolean) => void;
}
