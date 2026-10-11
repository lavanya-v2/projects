import type { Project } from "../../../types";

export interface Account {
  id: number;
  name: string;
  code: string;
  description?: string;
  amberThresholdPercentage: number;
  redThresholdPercentage: number;
  redProjectCountFloor: number;
  redCeilingBadPercentage: number | null;
  weekStartDay: number;
  hasFullAccess?: boolean;
  projectCounts?: number;
  memberCounts?: number;
}

interface Projects {
  id:number;
  name: string;
  code: string;
}

interface Accounts {
  id: number;
  name: string;
}
interface AccountAssociation {
  id:number;
  accountId: number;
  teamMemberId: number;
  projectId: number;
  role: string;
  dailyCapacityHours: number | null;
  createdAt: Date;
  updatedAt: Date;
  project : Projects;
  account: Accounts
}

export interface ProjectMembers {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  jiraLoginId: string;
  partnerEmailId: string;
  v2Member: boolean;
  createdAt: Date;
  updatedAt: Date;
  accountAssociations: AccountAssociation[];
}

export interface MembersApiResponse {
  success: boolean;
  data: ProjectMembers[];
  total?: number;
}

export interface ProjectApiResponse {
  success: boolean;
  data: Project[];
  total?: number;
}
