import { Router } from "express";
import authRoutes from "@/routes/auth.routes";
import prescriptionRoutes from "@/routes/prescription.routes";
import medicationRoutes from "@/routes/medication.routes";
import scheduleRoutes from "@/routes/schedule.routes";
import reminderRoutes from "@/routes/reminder.routes";
import medicineRoutes from "@/routes/medicine.routes";
import scriptyRoutes from "@/routes/scripty.routes";

const router = Router();

router.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

router.use("/auth", authRoutes);
router.use("/prescriptions", prescriptionRoutes);
router.use("/medications", medicationRoutes);
router.use("/schedule", scheduleRoutes);
router.use("/reminders", reminderRoutes);
router.use("/medicines", medicineRoutes);
router.use("/scripty", scriptyRoutes);

export default router;
