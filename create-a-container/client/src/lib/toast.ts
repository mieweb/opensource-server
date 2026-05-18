import { useToast } from '@mieweb/ui';
import type { ApiError } from './api';

/**
 * Centralized error-to-toast helper. Pass to mutation `onError`.
 */
export function useApiErrorToast() {
  const { error } = useToast();
  return (err: unknown) => {
    const e = err as ApiError;
    if (e && typeof e === 'object' && 'message' in e) {
      error(e.message || 'Request failed');
    } else {
      error('Request failed');
    }
  };
}
