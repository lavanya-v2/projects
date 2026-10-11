export type RiskSource = 'CLIENT' | 'INTERNAL' ;
export type RiskPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type RiskStatus = 'NEW' | 'WORK_IN_PROGRESS' | 'STALE' | 'DONE';

export interface RiskUser {
    id: number;
    firstName: string;
    lastName: string;
}

export interface RiskProject {
    id: number;
    name: string;
    accountId: number;
}

export interface RiskPermissions {
    canView: boolean;
    canEdit: boolean;
    canComment: boolean;
    canTransition: boolean;
    canMarkDone: boolean;
    canDelete: boolean;
}

export interface Risk {
    id: number;
    source: RiskSource;
    notifiedDate: string;
    title: string;
    description: string;
    priority: RiskPriority;
    status: RiskStatus;
    createdAt: string;
    updatedAt: string;
    creatorId: number;
    assigneeId: number | null;
    projectId: number | null;
    creator: RiskUser;
    assignee: RiskUser | null;
    project: RiskProject | null;
    permissions?: RiskPermissions;
}

export interface RiskComment {
    id: number;
    comment: string;
    createdAt: string;
    editedAt?: string | null;
    userId: number;
    user: RiskUser;
}

export interface RiskMitigationPlan {
    id: number;
    description: string;
    createdAt: string;
}

export interface RiskDetail extends Risk {
    resolution: string | null;
    aiSummary?: string | null;
    comments: RiskComment[];
    mitigationPlans: RiskMitigationPlan[];
    permissions?: RiskPermissions;
}

export interface CreateRiskPayload {
    source: RiskSource;
    notifiedDate: string;
    title: string;
    description: string;
    priority: RiskPriority;
    assigneeId?: number;
    projectId?: number;
}
