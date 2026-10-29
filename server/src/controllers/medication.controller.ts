import type { Request, Response } from "express";
import { asyncHandler } from "@/utils/asyncHandler";
import * as medicationService from "@/services/medication.service";
import * as scheduleService from "@/services/schedule.service";

export const update = asyncHandler(async (req: Request, res: Response) => {
  const medication = await medicationService.updateMedication(req.user!.id, req.params.id, req.body);
  res.status(200).json({ medication });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const medications = await medicationService.listMedicationsForUser(req.user!.id);
  res.status(200).json({ medications });
});

export const schedulePreview = asyncHandler(async (req: Request, res: Response) => {
  const preview = await scheduleService.getScheduleSuggestion(req.user!.id, req.params.id);
  res.status(200).json({ preview });
});

export const information = asyncHandler(async (req: Request, res: Response) => {
  const result = await medicationService.getMedicationInformation(req.user!.id, req.params.id);
  res.status(200).json(result);
});

export const price = asyncHandler(async (req: Request, res: Response) => {
  const result = await medicationService.getMedicationPrice(req.user!.id, req.params.id);
  res.status(200).json(result);
});

export const createManual = asyncHandler(async (req: Request, res: Response) => {
  const medication = await medicationService.createManualMedication(req.user!.id, req.body);
  res.status(201).json({ medication });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await medicationService.deleteMedication(req.user!.id, req.params.id);
  res.status(204).end();
});
