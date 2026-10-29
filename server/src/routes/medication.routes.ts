import { Router } from "express";
import * as medicationController from "@/controllers/medication.controller";
import { requireAuth } from "@/middleware/auth.middleware";
import { csrfProtection } from "@/middleware/csrf.middleware";
import { validate } from "@/middleware/validate.middleware";
import { createManualMedicationSchema, updateMedicationSchema } from "@/validation/medication.schema";

const router = Router();

router.use(requireAuth);

router.get("/", medicationController.list);
// A medicine the user adds themselves, without a prescription.
router.post("/", csrfProtection, validate(createManualMedicationSchema), medicationController.createManual);
router.get("/:id/schedule-preview", medicationController.schedulePreview);
// Per-medication lookups. Read-only, so no CSRF; ownership is enforced
// inside the service by querying on userId.
router.get("/:id/information", medicationController.information);
router.get("/:id/price", medicationController.price);
router.patch("/:id", csrfProtection, validate(updateMedicationSchema), medicationController.update);
router.delete("/:id", csrfProtection, medicationController.remove);

export default router;
