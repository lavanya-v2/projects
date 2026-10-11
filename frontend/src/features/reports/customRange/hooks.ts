import { useQuery, useMutation } from '@tanstack/react-query';
import { client } from '../../../api/client';
import type { ApiResponse } from '../../../shared/apiTypes';
import type { CustomRangeParams, CustomRangeProjectList, CustomRangeReportData } from './types';

const projectsKey = (accountId?: number) => ['custom-range-report', 'projects', { accountId }] as const;

const fetchProjects = async (accountId?: number): Promise<CustomRangeProjectList> => {
  const response = await client.get<ApiResponse<CustomRangeProjectList>>('/report/custom-range/projects', {
    params: accountId ? { accountId } : undefined,
  });
  return response.data.data;
};

const generate = async (params: CustomRangeParams): Promise<CustomRangeReportData> => {
  const response = await client.post<ApiResponse<CustomRangeReportData>>('/report/custom-range', params);
  return response.data.data;
};

const downloadBlob = (data: BlobPart, fileName: string) => {
  const url = window.URL.createObjectURL(new Blob([data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  link.parentNode?.removeChild(link);
  window.URL.revokeObjectURL(url);
};

const download = async (params: CustomRangeParams, format: 'txt' | 'eml') => {
  const response = await client.get('/report/custom-range/download', {
    params: { ...params, format },
    responseType: 'blob',
  });
  const cd = response.headers['content-disposition'] as string | undefined;
  const m = cd?.match(/filename="?([^"]+)"?/);
  const fallback = `progress_${params.startDate}_to_${params.endDate}.${format}`;
  downloadBlob(response.data, m ? m[1] : fallback);
};

export const useCustomRangeProjects = (accountId?: number) =>
  useQuery({ queryKey: projectsKey(accountId), queryFn: () => fetchProjects(accountId), staleTime: 5 * 60 * 1000 });

export const useGenerateCustomRange = () => useMutation({ mutationFn: generate });

export const useDownloadCustomRange = () =>
  useMutation({ mutationFn: (v: { params: CustomRangeParams; format: 'txt' | 'eml' }) => download(v.params, v.format) });

/** Server error text (e.g. the 15-day message) when the API returned one. */
export const apiErrorMessage = (err: unknown, fallback: string): string => {
  const e = err as { response?: { data?: { error?: string } } };
  return e?.response?.data?.error || fallback;
};
