import { Router } from "express";
import * as scheduleController from "@/controllers/schedule.controller";
import { requireAuth } from "@/middleware/auth.middleware";
import { csrfProtection } from "@/middleware/csrf.middleware";
import { validate } from "@/middleware/validate.middleware";
import { createScheduleSchema, editScheduleSchema, scheduleQuerySchema, updateScheduleSchema } from "@/validation/schedule.schema";

const router = Router();

router.use(requireAuth);

// NOTE: /list must be registered before the parameterized PATCH /:id route
// below (not actually ambiguous here since methods differ, but kept in a
// predictable order regardless).
router.get("/list", scheduleController.list);
router.get("/", validate(scheduleQuerySchema, "query"), scheduleController.getForDate);
router.post("/", csrfProtection, validate(createScheduleSchema), scheduleController.create);
router.patch("/:id", csrfProtection, validate(updateScheduleSchema), scheduleController.updateStatus);
// Editing times, days, end date, dose or notifications. Separate from the
// status PATCH above so a status change can never carry edits with it.
router.put("/:id", csrfProtection, validate(editScheduleSchema), scheduleController.edit);

export default router;
