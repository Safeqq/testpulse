import { z } from "zod";

export const createTokenBody = z.object({
  name: z.string().trim().min(1, "Nama token wajib diisi").max(60, "Nama token maksimal 60 karakter"),
});
export type CreateTokenBody = z.infer<typeof createTokenBody>;

export const tokenDto = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  createdBy: z.object({ id: z.string(), name: z.string() }),
});
export type TokenDto = z.infer<typeof tokenDto>;

// Nilai `token` hanya dikembalikan sekali, saat dibuat.
export const createdTokenDto = z.object({
  id: z.string(),
  name: z.string(),
  token: z.string(),
  createdAt: z.string(),
});
export type CreatedTokenDto = z.infer<typeof createdTokenDto>;
