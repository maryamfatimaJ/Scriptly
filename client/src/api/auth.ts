import { apiRequest, resetCsrfToken } from "./client";
import type { User } from "@/types";

export function login(email: string, password: string) {
  return apiRequest<{ user: User }>("/auth/login", { method: "POST", body: { email, password } }).finally(
    resetCsrfToken
  );
}

export function register(email: string, password: string, fullName: string, timezone?: string) {
  return apiRequest<{ user: User }>("/auth/register", {
    method: "POST",
    body: { email, password, fullName, timezone },
  }).finally(resetCsrfToken);
}

export function logout() {
  return apiRequest<void>("/auth/logout", { method: "POST" }).finally(resetCsrfToken);
}

export function getCurrentUser() {
  return apiRequest<{ user: User }>("/auth/me");
}

export function updateProfile(input: { fullName?: string; timezone?: string }) {
  return apiRequest<{ user: User }>("/auth/me", { method: "PATCH", body: input });
}
