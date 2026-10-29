import { Router } from "express";
import * as authController from "@/controllers/auth.controller";
import { validate } from "@/middleware/validate.middleware";
import { requireAuth } from "@/middleware/auth.middleware";
import { csrfProtection } from "@/middleware/csrf.middleware";
import { authRateLimiter } from "@/middleware/rateLimit.middleware";
import { registerSchema, loginSchema, updateProfileSchema } from "@/validation/auth.schema";

const router = Router();

router.get("/csrf-token", authController.csrfToken);
router.post("/register", authRateLimiter, validate(registerSchema), authController.register);
router.post("/login", authRateLimiter, validate(loginSchema), authController.login);
router.post("/refresh", authRateLimiter, authController.refresh);
router.post("/logout", csrfProtection, authController.logout);
router.get("/me", requireAuth, authController.me);
router.patch("/me", requireAuth, csrfProtection, validate(updateProfileSchema), authController.updateMe);

export default router;
