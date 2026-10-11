import type { ActionItemComment } from "../../types";
import type { RetroBoardStatus } from "../retro-board/types";

export interface UserInfo {
  id: number;
  firstName: string;
  lastName: string;
}

export const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  Open: ["In-Progress", "Closed", "Discarded"],
  "In-Progress": ["Closed", "Discarded"],
  Closed: [],
  Discarded: [],
};

export interface ActionItemType {
  id: number;
  title: string;
  category:
    | "Task"
    | "Follow-up"
    | "Issue"
    | "Decision Required"
    | "Risk & Mitigation"
    | "Dependency";
  owner: string;
  status: RetroBoardStatus;
  dueDate: string;
  createdBy: UserInfo;
  createdById: number;
  createdAt: string | Date;
  updatedAt: string | Date;
  comments: ActionItemComment[];
  statusHistory: ActionItemStatusHistory[];
  projectId?: number;
  programId?: number;
  accountId?: number;
  relatedName?: string;
}

export type ActionItemTab = "account-items" | "project-items" | "program-items";

export interface ActionItem {
  id: number;
  title: string;
  category: string;
  owner: string;
  status: string;
  createdById?: number;
  dueDate?: string | null;

  // Generic display name for Account / Project / Program
  relatedName?: string;
}

export interface SortConfig {
  column: string;
  direction: "ASC" | "DESC";
}

export interface ActionItemStatusHistory {
  id: number;
  actionItemId: number | null;
  accountActionItemId: number | null;
  programActionItemId: number | null;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  changedBy: UserInfo;
  changedAt: Date;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  totalItems: number;
}

export interface ActionItemCreateData {
  accountId: string;
  projectId?: string;
  programId?: string;
  title: string;
  category: string;
  owner: string;
  dueDate: string;
}
export interface ActionItemFilters {
  search: string;
  status: string;
  category: string;
  owner: string;
  accountId?: string;
  projectId?: string;
  programId?: string;
}
