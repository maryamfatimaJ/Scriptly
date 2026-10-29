import { apiRequest } from "./client";
import type { ReminderStatus, Schedule, ScheduleReminder, ScheduleStatus, ScheduleSuggestion } from "@/types";

export function getScheduleForDate(date?: string) {
  const query = date ? `?date=${date}` : "";
  return apiRequest<{ date: string; reminders: ScheduleReminder[] }>(`/schedule${query}`);
}

export function getScheduleForWeek(date?: string) {
  const query = date ? `date=${date}&` : "";
  return apiRequest<{ anchorDate: string; days: Record<string, ScheduleReminder[]> }>(`/schedule?${query}view=week`);
}

export function listSchedules() {
  return apiRequest<{ schedules: Schedule[] }>("/schedule/list");
}

export function getSchedulePreview(medicationId: string) {
  return apiRequest<{ preview: ScheduleSuggestion }>(`/medications/${medicationId}/schedule-preview`);
}

export interface CreateSchedulePayload {
  medicationId: string;
  startDate: string;
  endDate?: string;
  slots: { timeOfDay: string; label?: string }[];
  notes?: string;
  doseAmount?: string;
  daysOfWeek?: number[];
  remindersEnabled?: boolean;
}

export interface EditSchedulePayload {
  slots?: { timeOfDay: string; label?: string }[];
  /** null = ongoing */
  endDate?: string | null;
  daysOfWeek?: number[];
  doseAmount?: string | null;
  notes?: string | null;
  remindersEnabled?: boolean;
}

export function createSchedule(payload: CreateSchedulePayload) {
  return apiRequest<{ schedule: Schedule }>("/schedule", { method: "POST", body: payload });
}

/** Edits times, days, end date, dose or notifications. Past doses are never changed. */
export function editSchedule(id: string, payload: EditSchedulePayload) {
  return apiRequest<{ schedule: Schedule }>(`/schedule/${id}`, { method: "PUT", body: payload });
}

export function updateScheduleStatus(id: string, status: ScheduleStatus) {
  return apiRequest<{ schedule: Schedule }>(`/schedule/${id}`, { method: "PATCH", body: { status } });
}

// PENDING is included so a mistaken mark can be undone — see
// server/src/services/reminder.service.ts, which keeps a before/after
// audit trail of every change rather than silently overwriting it.
export function updateReminder(id: string, status: Extract<ReminderStatus, "TAKEN" | "MISSED" | "SKIPPED" | "PENDING">) {
  return apiRequest<{ reminder: unknown }>(`/reminders/${id}`, { method: "PATCH", body: { status } });
}
