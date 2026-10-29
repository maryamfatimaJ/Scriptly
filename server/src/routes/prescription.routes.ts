import { Router } from "express";
import * as prescriptionController from "@/controllers/prescription.controller";
import { requireAuth } from "@/middleware/auth.middleware";
import { csrfProtection } from "@/middleware/csrf.middleware";
import { uploadPrescriptionImage, verifyUploadedImageSignature } from "@/middleware/upload.middleware";

const router = Router();

router.use(requireAuth);

router.get("/", prescriptionController.list);
router.get("/:id", prescriptionController.getById);
router.get("/:id/image", prescriptionController.getImage);
router.get("/:id/events", prescriptionController.getEvents);
router.get("/:id/summary", prescriptionController.summary);
router.post("/", csrfProtection, uploadPrescriptionImage, verifyUploadedImageSignature, prescriptionController.create);
router.post("/:id/extract", csrfProtection, prescriptionController.extract);
router.post("/:id/approve", csrfProtection, prescriptionController.approve);
router.post("/:id/reject", csrfProtection, prescriptionController.reject);
router.post("/:id/request-clarification", csrfProtection, prescriptionController.requestClarification);
router.delete("/:id", csrfProtection, prescriptionController.remove);

export default router;
