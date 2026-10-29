import type { Request, Response } from "express";
import { asyncHandler } from "@/utils/asyncHandler";
import * as medicineService from "@/services/medicine.service";

export const search = asyncHandler(async (req: Request, res: Response) => {
  const { q, strength, form, page, pageSize, limit } = req.query as unknown as {
    q: string;
    strength?: string;
    form?: string;
    page?: number;
    pageSize?: number;
    limit?: number;
  };
  const result = await medicineService.searchCatalogue({ q, strength, form, page, pageSize: pageSize ?? limit });

  // The response carries the query back and reports the total found, so
  // the client can distinguish "no results" from "request never ran"
  // without inferring it from an empty array.
  res.status(200).json({
    query: q,
    interpreted: result.interpreted,
    count: result.total,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    hasMore: result.hasMore,
    medicines: result.hits.map((hit) => ({
      ...hit.medicine,
      matchScore: hit.score,
      matchedOn: hit.matchedOn,
      image: hit.image,
    })),
  });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const detail = await medicineService.getMedicineById(req.params.id);
  res.status(200).json(detail);
});

export const price = asyncHandler(async (req: Request, res: Response) => {
  const { name, strength, form } = req.query as unknown as {
    name: string;
    strength?: string;
    form?: string;
  };
  const result = await medicineService.lookupPriceByName({ name, strength, form });
  res.status(200).json({ price: result });
});

export const image = asyncHandler(async (req: Request, res: Response) => {
  const { filePath, mimeType } = await medicineService.getMedicineImageFile(req.params.id, req.params.imageId);
  res.setHeader("Content-Type", mimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.sendFile(filePath);
});

export const suggestions = asyncHandler(async (_req: Request, res: Response) => {
  res.status(200).json({ suggestions: await medicineService.getSuggestions() });
});
