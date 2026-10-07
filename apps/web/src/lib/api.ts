import type { ApiErrorCode, ApiResponse } from '@taazastream/shared';
import { usePrefs } from '../store/prefs';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode | 'NETWORK',
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** True when the TaazaStream server itself could not be reached (Wi-Fi drop, server off). */
  get isNetwork() {
    return this.code === 'NETWORK';
  }
}

function headers(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  // Custom header required by the server for state-changing requests (CSRF protection).
  h.set('x-taazastream', '1');
  const profileId = usePrefs.getState().profileId;
  if (profileId) h.set('x-profile-id', profileId);
  return h;
}

async function request<T>(method: string, url: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const h = headers(init.headers);
  if (body !== undefined && !isForm) h.set('content-type', 'application/json');
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      method,
      headers: h,
      credentials: 'same-origin',
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the TaazaStream server. Check that you are on the same Wi-Fi and the server is running.');
  }
  let json: ApiResponse<T> | null = null;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    json = null;
  }
  if (!json) throw new ApiError(res.status, 'INTERNAL_ERROR', `Unexpected response (${res.status})`);
  if (!json.ok) throw new ApiError(res.status, json.error.code, json.error.message, json.error.details);
  return json.data;
}

export const api = {
  get: <T>(url: string, init?: RequestInit) => request<T>('GET', url, undefined, init),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  delete: <T>(url: string) => request<T>('DELETE', url),
  upload: <T>(url: string, form: FormData) => request<T>('POST', url, form),
};

/** Fire-and-forget POST that survives page unload (progress on tab close). */
export function beacon(url: string, body: unknown) {
  try {
    void fetch(url, {
      method: 'POST',
      keepalive: true,
      credentials: 'same-origin',
      headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
    });
  } catch {
    /* ignore */
  }
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
}
