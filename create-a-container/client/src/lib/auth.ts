import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, clearCsrfToken } from './api';

export interface SessionUser {
  user: string;
  isAdmin: boolean;
}

export const sessionKey = ['session'] as const;

export function useSession() {
  return useQuery<SessionUser | null>({
    queryKey: sessionKey,
    queryFn: async () => {
      try {
        return await api.get<SessionUser>('/api/v1/session');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

export interface LoginInput {
  username: string;
  password: string;
  redirect?: string;
}

export type LoginResult =
  | { kind: 'logged-in'; user: string; isAdmin: boolean; redirect: string }
  | { kind: '2fa'; challengeId: string };

interface LoginResponse {
  user?: string;
  isAdmin?: boolean;
  redirect?: string;
  challengeId?: string;
  requires2FA?: boolean;
}

export function useLoginMutation() {
  const qc = useQueryClient();
  return useMutation<LoginResult, ApiError, LoginInput>({
    mutationFn: async (input) => {
      const data = await api.post<LoginResponse>('/api/v1/auth/login', input);
      if (data.requires2FA && data.challengeId) {
        return { kind: '2fa', challengeId: data.challengeId };
      }
      return {
        kind: 'logged-in',
        user: data.user || input.username,
        isAdmin: !!data.isAdmin,
        redirect: data.redirect || '/',
      };
    },
    onSuccess: (result) => {
      if (result.kind === 'logged-in') {
        qc.setQueryData<SessionUser>(sessionKey, {
          user: result.user,
          isAdmin: result.isAdmin,
        });
      }
    },
  });
}

export interface ChallengeStatus {
  status: 'pending' | 'approved' | 'rejected' | 'timeout' | 'failed' | 'unregistered';
  user?: string;
  isAdmin?: boolean;
  redirect?: string;
  message?: string;
  registrationUrl?: string;
}

export async function fetchChallenge(id: string): Promise<ChallengeStatus> {
  return api.get<ChallengeStatus>(`/api/v1/auth/login/challenge/${encodeURIComponent(id)}`);
}

export function useLogoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.post('/api/v1/auth/logout');
    },
    onSettled: () => {
      clearCsrfToken();
      qc.setQueryData<SessionUser | null>(sessionKey, null);
      qc.clear();
    },
  });
}
