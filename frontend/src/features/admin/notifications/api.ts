import type { AxiosRequestConfig } from 'axios';
import { client } from '../../../api/client';

export interface NotificationEventDto {
    code: string;
    description: string | null;
    payloadSchema: unknown;
    isActive: boolean;
}

export interface NotificationTemplateDto {
    id: number;
    code: string;
    name: string;
    transport: string;
    subjectTemplate: string | null;
    bodyTemplate: string;
    isActive: boolean;
}

export interface NotificationRuleDto {
    id: number;
    eventCode: string;
    templateId: number;
    transport: string;
    recipientsConfig: { roles?: string[]; scope?: string };
    ccConfig: { emails?: string[] } | null;
    scopeConfig: { projectIds?: number[]; accountIds?: number[] } | null;
    coalesceWindowSeconds: number | null;
    coalesceKeyConfig: string[] | null;
    isActive: boolean;
    priority: number;
    template?: NotificationTemplateDto;
    event?: NotificationEventDto;
}

export interface NotificationLogDto {
    id: number;
    eventCode: string;
    ruleId: number | null;
    templateId: number | null;
    transport: string;
    recipients: string[];
    cc: string[] | null;
    subject: string | null;
    body: string | null;
    payloadSnapshot: unknown;
    status: 'QUEUED' | 'SENT' | 'FAILED' | 'SKIPPED';
    error: string | null;
    projectId: number | null;
    accountId: number | null;
    projectName?: string | null;
    accountName?: string | null;
    jobId: string | null;
    sentAt: string | null;
    createdAt: string;
}

export interface ApiResponse<T> {
    success: boolean;
    data: T[];
    totalItems: number;
}

const BASE = '/admin/notifications';

export const notificationsApi = {
    listEventsWithPagination: (pageNumber?: number, pageLimit?: number, config?:AxiosRequestConfig) => client.get<ApiResponse<NotificationEventDto>>(`${BASE}/events/pagination?pageNumber=${pageNumber}&pageLimit=${pageLimit}`, config).then(r => r.data),
    listEventsWithoutPagination: (config?: AxiosRequestConfig) => client.get<NotificationEventDto[]>(`${BASE}/events`,config).then(r => r.data),

    listTemplatesWithPagination: (pageNumber?: number, pageLimit?: number, config?:AxiosRequestConfig) => client.get<ApiResponse<NotificationTemplateDto>>(`${BASE}/templates/pagination?pageNumber=${pageNumber}&pageLimit=${pageLimit}`, config).then(r => r.data),
    listTemplatesWithoutPagination: (config?: AxiosRequestConfig) => client.get<NotificationTemplateDto[]>(`${BASE}/templates`, config).then(r => r.data),
    createTemplate: (body: Partial<NotificationTemplateDto>) =>
        client.post<NotificationTemplateDto>(`${BASE}/templates`, body).then(r => r.data),
    updateTemplate: (id: number, body: Partial<NotificationTemplateDto>) =>
        client.put<NotificationTemplateDto>(`${BASE}/templates/${id}`, body).then(r => r.data),
    deleteTemplate: (id: number) => client.delete(`${BASE}/templates/${id}`),

    listRules: (pageNumber: number, pageLimit: number, config?: AxiosRequestConfig) => client.get<ApiResponse<NotificationRuleDto>>(`${BASE}/rules?pageNumber=${pageNumber}&pageLimit=${pageLimit}`, config).then(r => r.data),
    createRule: (body: Partial<NotificationRuleDto>) =>
        client.post<NotificationRuleDto>(`${BASE}/rules`, body).then(r => r.data),
    updateRule: (id: number, body: Partial<NotificationRuleDto>) =>
        client.put<NotificationRuleDto>(`${BASE}/rules/${id}`, body).then(r => r.data),
    deleteRule: (id: number) => client.delete(`${BASE}/rules/${id}`),

    listLogs: (params: { cap?: number; status?: string; eventCode?: string; accountId?: number | string, projectId?: number | string ; fromDate?: string; toDate?: string; page: number; limit: number }, config?:AxiosRequestConfig) =>
        client.get<{ data: NotificationLogDto[]; count: number }>(`${BASE}/logs`, { params, ...config }).then(r => r.data),
    getLog: (id: number) => client.get<NotificationLogDto>(`${BASE}/logs/${id}`).then(r => r.data),

    listPending: (config?:AxiosRequestConfig) =>
        client.get<{ items: NotificationPendingDto[] }>(`${BASE}/logs/pending`,config).then(r => r.data),
};

export interface NotificationPendingDto {
    id: number;
    ruleId: number;
    eventCode: string | null;
    coalesceKey: string;
    flushAt: string;
    createdAt: string;
    eventCount: number;
    jobId: string | null;
}
