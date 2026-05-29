import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, clearCsrfToken } from './api';

export interface SessionUser {
  user: string;
  isAdmin: boolean;
  /** Configured push-notification service URL (admins only, empty if unset). */
  pushNotificationUrl?: string;
}

export interface ServerInfo {
  status: string;
  isDev: boolean;
}

export const sessionKey = ['session'] as const;
export const serverInfoKey = ['server-info'] as const;

export function useServerInfo() {
  return useQuery<ServerInfo>({
    queryKey: serverInfoKey,
    queryFn: () => api.get<ServerInfo>('/api/v1/health'),
    staleTime: Infinity,
  });
}

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
    onSuccess: async (result) => {
      if (result.kind === 'logged-in') {
        // Drop any pre-login CSRF token so the next mutation fetches one bound
        // to the authenticated session, proactively rather than reacting to a
        // 403. Avoids forbidden responses that would trip backend rate limits.
        clearCsrfToken();
        qc.setQueryData<SessionUser>(sessionKey, {
          user: result.user,
          isAdmin: result.isAdmin,
        });
        // Refetch from the server so the cached session reflects the
        // authoritative state (including pushNotificationUrl) before the
        // caller navigates into a guarded route.
        await qc.refetchQueries({ queryKey: sessionKey });
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

export interface DevLoginInput {
  role: 'admin' | 'user';
}

interface DevLoginResponse {
  user: string;
  isAdmin: boolean;
  redirect?: string;
}

/**
 * One-click dev login (non-production only). The /api/v1/auth/dev endpoint
 * returns 404 in production, so the UI gates this behind useServerInfo().isDev.
 */
export function useDevLoginMutation() {
  const qc = useQueryClient();
  return useMutation<DevLoginResponse, ApiError, DevLoginInput>({
    mutationFn: (input) => api.post<DevLoginResponse>('/api/v1/auth/dev', input),
    onSuccess: async (data) => {
      clearCsrfToken();
      qc.setQueryData<SessionUser>(sessionKey, {
        user: data.user,
        isAdmin: data.isAdmin,
      });
      await qc.refetchQueries({ queryKey: sessionKey });
    },
  });
}
