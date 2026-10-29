import { Router } from "express";
import * as reminderController from "@/controllers/reminder.controller";
import { requireAuth } from "@/middleware/auth.middleware";
import { csrfProtection } from "@/middleware/csrf.middleware";
import { validate } from "@/middleware/validate.middleware";
import { updateReminderSchema } from "@/validation/reminder.schema";

const router = Router();

router.use(requireAuth);

router.patch("/:id", csrfProtection, validate(updateReminderSchema), reminderController.update);

export default router;
