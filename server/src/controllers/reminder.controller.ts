import type { Request, Response } from "express";
import { asyncHandler } from "@/utils/asyncHandler";
import * as reminderService from "@/services/reminder.service";

export const update = asyncHandler(async (req: Request, res: Response) => {
  const reminder = await reminderService.updateReminder(req.user!.id, req.params.id, req.body);
  res.status(200).json({ reminder });
});
