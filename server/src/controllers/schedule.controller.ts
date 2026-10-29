import type { Request, Response } from "express";
import { asyncHandler } from "@/utils/asyncHandler";
import * as scheduleService from "@/services/schedule.service";

export const getForDate = asyncHandler(async (req: Request, res: Response) => {
  const { date, view } = req.query as { date?: string; view?: "day" | "week" };

  if (view === "week") {
    const byDate = await scheduleService.getScheduleForWeek(req.user!.id, date);
    return res.status(200).json({ view: "week", anchorDate: date ?? new Date().toISOString().slice(0, 10), days: byDate });
  }

  const reminders = await scheduleService.getScheduleForDate(req.user!.id, date);
  res.status(200).json({ view: "day", date: date ?? new Date().toISOString().slice(0, 10), reminders });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const schedules = await scheduleService.listSchedules(req.user!.id);
  res.status(200).json({ schedules });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const schedule = await scheduleService.createSchedule(req.user!.id, req.body);
  res.status(201).json({ schedule });
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const schedule = await scheduleService.updateScheduleStatus(req.user!.id, req.params.id, req.body.status);
  res.status(200).json({ schedule });
});

export const edit = asyncHandler(async (req: Request, res: Response) => {
  const schedule = await scheduleService.editSchedule(req.user!.id, req.params.id, req.body);
  res.status(200).json({ schedule });
});
