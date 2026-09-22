// Client-side auth helpers — store JWT in localStorage, parse user from it

export type AccountType = "viewer" | "creator";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  account_type: AccountType;
  department?: string;
}

const TOKEN_KEY = "redactor_token";
const USER_KEY = "redactor_user";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

// Caches the last-parsed user alongside the raw string it came from, so
// repeated calls return the SAME object reference (===-stable) as long as
// localStorage hasn't actually changed — only re-parses (and only then
// returns a new object identity) when the raw value differs from what was
// cached. This is required for useSyncExternalStore consumers: React
// compares getSnapshot's return value with Object.is between renders, and
// a plain JSON.parse-every-call implementation returns a new object every
// time even when nothing changed, which reads as "changed every render"
// and causes an infinite re-render loop (confirmed via testing on
// app/profile/page.tsx, which hit exactly this — "Maximum update depth
// exceeded" — before this fix). Plain (non-useSyncExternalStore) callers
// are unaffected: the returned data is identical either way, this only
// changes reference identity when nothing semantically changed.
let cachedRaw: string | null = null;
let cachedUser: AuthUser | null = null;

export function getUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (raw === cachedRaw) return cachedUser;
  cachedRaw = raw;
  if (!raw) {
    cachedUser = null;
    return null;
  }
  try {
    cachedUser = JSON.parse(raw) as AuthUser;
  } catch {
    cachedUser = null;
  }
  return cachedUser;
}

export function setAuth(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

export function isCreator(): boolean {
  return getUser()?.account_type === "creator";
}
