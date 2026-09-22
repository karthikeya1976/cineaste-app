// Unit tests for lib/auth.ts — JWT/user localStorage helpers.
// Pure client-side logic, no network — safe to run in any CI environment.
import { describe, it, expect, beforeEach } from "vitest";
import { getToken, getUser, setAuth, clearAuth, type AuthUser } from "./auth";

const USER: AuthUser = {
  id: "u1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  account_type: "creator",
  department: "Editing",
};

describe("auth localStorage helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null token when nothing stored", () => {
    expect(getToken()).toBeNull();
  });

  it("returns null user when nothing stored", () => {
    expect(getUser()).toBeNull();
  });

  it("round-trips token and user via setAuth/getToken/getUser", () => {
    setAuth("jwt-abc123", USER);
    expect(getToken()).toBe("jwt-abc123");
    expect(getUser()).toEqual(USER);
  });

  it("clearAuth removes both token and user", () => {
    setAuth("jwt-abc123", USER);
    clearAuth();
    expect(getToken()).toBeNull();
    expect(getUser()).toBeNull();
  });

  it("getUser does not throw on malformed stored JSON — returns null instead", () => {
    localStorage.setItem("redactor_user", "{not valid json");
    expect(getUser()).toBeNull();
  });

  // getUser() caches by reference for useSyncExternalStore compatibility
  // (see auth.ts's own comment) — these confirm the cache is both stable
  // when nothing changed AND correctly invalidates when it did, since a
  // stale-cache bug here would silently break any consumer relying on
  // fresh data after a setAuth/clearAuth call (e.g. profile page's
  // post-upgrade re-read).
  it("returns the SAME object reference across repeated calls when localStorage hasn't changed", () => {
    setAuth("jwt-abc123", USER);
    const first = getUser();
    const second = getUser();
    expect(first).toBe(second); // referential equality, not just .toEqual
  });

  it("returns a NEW object reference after setAuth overwrites the stored user", () => {
    setAuth("jwt-abc123", USER);
    const first = getUser();
    const updated: AuthUser = { ...USER, name: "Grace Hopper" };
    setAuth("jwt-abc123", updated);
    const second = getUser();
    expect(second).not.toBe(first);
    expect(second).toEqual(updated);
  });

  it("cache correctly returns null after clearAuth, not a stale prior user", () => {
    setAuth("jwt-abc123", USER);
    getUser(); // populate the cache
    clearAuth();
    expect(getUser()).toBeNull();
  });
});
