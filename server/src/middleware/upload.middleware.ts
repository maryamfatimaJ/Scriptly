import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import type { NextFunction, Request, Response } from "express";
import { env } from "@/config/env";

// Images only. PDF was previously accepted but nothing downstream could
// render or extract it — the review screen renders via <img>, and the
// vision providers take raw image bytes. Accepting a format the pipeline
// cannot process is worse than rejecting it clearly.
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const uploadRoot = path.resolve(process.cwd(), env.uploadDir);
fs.mkdirSync(uploadRoot, { recursive: true });

// Thrown from fileFilter so error.middleware.ts can tell "unsupported file
// type" apart from other errors with a clean 400 instead of a generic 500.
export class UnsupportedFileTypeError extends Error {
  constructor(mimeType: string) {
    super(`Unsupported file type: ${mimeType}. Allowed: JPG, JPEG, PNG, WebP.`);
    this.name = "UnsupportedFileTypeError";
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `${crypto.randomUUID()}${ext}`;
    cb(null, safeName);
  },
});

export const uploadPrescriptionImage = multer({
  storage,
  limits: { fileSize: env.maxUploadSizeMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new UnsupportedFileTypeError(file.mimetype));
      return;
    }
    cb(null, true);
  },
}).single("prescriptionImage");

export const uploadRootDir = uploadRoot;

/** The first bytes of each accepted format. */
function signatureMatches(header: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case "image/jpeg":
      return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    case "image/png":
      return header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/webp":
      return header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP";
    default:
      return false;
  }
}

/**
 * Runs after uploadPrescriptionImage. multer's fileFilter only sees the
 * MIME type the browser DECLARED, which a renamed file controls. This
 * reads the file's own signature bytes and rejects (and deletes) anything
 * that isn't actually the image format it claims to be.
 */
export function verifyUploadedImageSignature(req: Request, _res: Response, next: NextFunction) {
  const file = req.file;
  if (!file) return next();
  try {
    const fd = fs.openSync(file.path, "r");
    const header = Buffer.alloc(12);
    fs.readSync(fd, header, 0, 12, 0);
    fs.closeSync(fd);
    if (!signatureMatches(header, file.mimetype)) {
      fs.rmSync(file.path, { force: true });
      return next(new UnsupportedFileTypeError(`${file.mimetype} (the file's contents are not a valid image of that type)`));
    }
    next();
  } catch (err) {
    fs.rmSync(file.path, { force: true });
    next(err);
  }
}
