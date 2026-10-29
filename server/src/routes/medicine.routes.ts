import { Router } from "express";
import * as medicineController from "@/controllers/medicine.controller";
import { requireAuth } from "@/middleware/auth.middleware";
import { validate } from "@/middleware/validate.middleware";
import { medicineImageParamsSchema, priceLookupSchema, searchMedicinesSchema } from "@/validation/medicine.schema";

const router = Router();

// Medicine reference data is not user-specific, but auth is still
// required so this does not become an open, unauthenticated scraping
// target for the reference database.
//
// IMPORTANT: the client route for these pages must sit behind RequireAuth
// to match (see client/src/App.tsx). When it didn't, every search by a
// signed-out visitor returned 401 and the page rendered it as "no results
// found" — a silent auth failure disguised as an empty database.
router.use(requireAuth);

// Registered before "/:id" so "price" is never parsed as a medicine id.
router.get("/search", validate(searchMedicinesSchema, "query"), medicineController.search);
router.get("/price", validate(priceLookupSchema, "query"), medicineController.price);
router.get("/suggestions", medicineController.suggestions);
router.get("/:id", medicineController.getById);
router.get("/:id/images/:imageId", validate(medicineImageParamsSchema, "params"), medicineController.image);

export default router;
