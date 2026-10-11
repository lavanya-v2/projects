import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '../../api/client';
import { profileKeys } from '../../shared/queryKeys';
import type { ApiResponse } from '../../shared/apiTypes';
import type { ProfileData, UpdateProfilePayload } from './types';

// ---- helpers ------------------------------------------------------------

const getMyProfile = async (): Promise<ProfileData> => {
  const response = await client.get<ApiResponse<ProfileData>>('/profile');
  return response.data.data;
};

const updateMyProfile = async (
  data: UpdateProfilePayload,
): Promise<{ id: number; userId: string; firstName: string; lastName: string, password: string }> => {
  const response = await client.put<ApiResponse<{ id: number; userId: string; firstName: string; lastName: string, password: string }>>(
    '/profile',
    data,
  );
  return response.data.data;
};

// ---- hooks --------------------------------------------------------------

/** Fetch the currently-authenticated user's profile (incl. read-only assignments). */
export const useMyProfile = (enabled = true) =>
  useQuery({
    queryKey: profileKeys.me(),
    queryFn: getMyProfile,
    enabled,
  });

/**
 * Mutation that updates the current user's editable profile fields
 * (firstName, lastName, password). Invalidates the profile query on success.
 */
export const useUpdateMyProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMyProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
    },
  });
};
