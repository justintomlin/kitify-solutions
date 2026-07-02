"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

export type Role = "user" | "admin";
export type User = { name: string; role: Role } | null;

type AuthContextValue = {
  user: User;
  ready: boolean; // false until localStorage has been read
  login: (name: string, role: Role) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "kitify_user";

// NOTE: This is a mock for the scaffold. The demo administrator account is
// preconfigured here; swap this out for real authentication when the portal is
// built out.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setUser(JSON.parse(saved));
    } catch {
      // ignore malformed storage
    }
    setReady(true);
  }, []);

  const login = useCallback((name: string, role: Role) => {
    const next = { name, role };
    setUser(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
