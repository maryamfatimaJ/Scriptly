import { apiRequest } from "./client";
import type { Prescription, PrescriptionEvent, PrescriptionSummary } from "@/types";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";

// Not JSON — used directly as an <img src>. The endpoint is
// cookie-authenticated and ownership-checked server-side; the <img> tag
// must set crossOrigin="use-credentials" so the browser actually sends
// the auth cookie on this cross-origin request in dev.
export function prescriptionImageUrl(id: string) {
  return `${BASE_URL}/prescriptions/${id}/image`;
}

export function listPrescriptions() {
  return apiRequest<{ prescriptions: Prescription[] }>("/prescriptions");
}

export function getPrescription(id: string) {
  return apiRequest<{ prescription: Prescription }>(`/prescriptions/${id}`);
}

export function getPrescriptionEvents(id: string) {
  return apiRequest<{ events: PrescriptionEvent[] }>(`/prescriptions/${id}/events`);
}

export function uploadPrescription(file: File) {
  const formData = new FormData();
  formData.append("prescriptionImage", file);
  return apiRequest<{ prescription: Prescription }>("/prescriptions", {
    method: "POST",
    body: formData,
    isFormData: true,
  });
}

export function extractPrescription(id: string) {
  return apiRequest<{ prescription: Prescription }>(`/prescriptions/${id}/extract`, { method: "POST" });
}

export function approvePrescription(id: string) {
  return apiRequest<{ prescription: Prescription }>(`/prescriptions/${id}/approve`, { method: "POST" });
}

export function rejectPrescription(id: string, reason?: string) {
  return apiRequest<{ prescription: Prescription }>(`/prescriptions/${id}/reject`, {
    method: "POST",
    body: { reason },
  });
}

export function requestClarification(id: string, note: string) {
  return apiRequest<{ prescription: Prescription }>(`/prescriptions/${id}/request-clarification`, {
    method: "POST",
    body: { note },
  });
}

/** What was actually saved for an approved prescription, read back from the server. */
export function getPrescriptionSummary(id: string) {
  return apiRequest<PrescriptionSummary>(`/prescriptions/${id}/summary`);
}

/** Deletes a prescription, its medicines, their reminders and the uploaded image. */
export function deletePrescription(id: string) {
  return apiRequest<void>(`/prescriptions/${id}`, { method: "DELETE" });
}
