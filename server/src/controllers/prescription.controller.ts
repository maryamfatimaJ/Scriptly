import type { Request, Response } from "express";
import path from "node:path";
import { asyncHandler } from "@/utils/asyncHandler";
import { AppError } from "@/utils/AppError";
import * as prescriptionService from "@/services/prescription.service";
import { rejectPrescriptionSchema, requestClarificationSchema } from "@/validation/prescription.schema";

export const create = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw AppError.badRequest("A prescription image (JPG, PNG or WebP) is required.");
  const prescription = await prescriptionService.createPrescription(req.user!.id, req.file);
  res.status(201).json({ prescription });
});

export const extract = asyncHandler(async (req: Request, res: Response) => {
  const prescription = await prescriptionService.runExtraction(req.user!.id, req.params.id);
  res.status(200).json({ prescription });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const prescriptions = await prescriptionService.listPrescriptions(req.user!.id);
  res.status(200).json({ prescriptions });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const prescription = await prescriptionService.getPrescription(req.user!.id, req.params.id);
  res.status(200).json({ prescription });
});

export const getEvents = asyncHandler(async (req: Request, res: Response) => {
  const events = await prescriptionService.getPrescriptionEvents(req.user!.id, req.params.id);
  res.status(200).json({ events });
});

// Streams the original image/PDF for one prescription — only to its
// owner. This is the only authenticated way to ever see the file; it is
// never reachable through a static/public path.
export const getImage = asyncHandler(async (req: Request, res: Response, next) => {
  const file = await prescriptionService.getPrescriptionImageFile(req.user!.id, req.params.id);
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Cache-Control", "private, no-store");
  res.sendFile(path.resolve(file.path), (err) => {
    if (err && !res.headersSent) {
      next(AppError.notFound("Prescription image could not be loaded."));
    }
  });
});

export const approve = asyncHandler(async (req: Request, res: Response) => {
  const prescription = await prescriptionService.approvePrescription(req.user!.id, req.params.id);
  res.status(200).json({ prescription });
});

export const reject = asyncHandler(async (req: Request, res: Response) => {
  const { reason } = rejectPrescriptionSchema.parse(req.body);
  const prescription = await prescriptionService.rejectPrescription(req.user!.id, req.params.id, reason);
  res.status(200).json({ prescription });
});

export const requestClarification = asyncHandler(async (req: Request, res: Response) => {
  const { note } = requestClarificationSchema.parse(req.body);
  const prescription = await prescriptionService.requestClarification(req.user!.id, req.params.id, note);
  res.status(200).json({ prescription });
});

export const summary = asyncHandler(async (req: Request, res: Response) => {
  const result = await prescriptionService.getPrescriptionSummary(req.user!.id, req.params.id);
  res.status(200).json(result);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await prescriptionService.deletePrescription(req.user!.id, req.params.id);
  res.status(204).end();
});
