import { z } from "zod";

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email maksimal 254 karakter")
  .pipe(z.email("Format email tidak valid"));

export const nameField = z
  .string()
  .trim()
  .min(1, "Nama wajib diisi")
  .max(80, "Nama maksimal 80 karakter");

export const registerBody = z.object({
  name: nameField,
  email: emailField,
  password: z.string().min(8, "Password minimal 8 karakter").max(128, "Password maksimal 128 karakter"),
});
export type RegisterBody = z.infer<typeof registerBody>;

export const loginBody = z.object({
  email: emailField,
  password: z.string().min(1, "Password wajib diisi").max(128, "Password maksimal 128 karakter"),
});
export type LoginBody = z.infer<typeof loginBody>;

export const userDto = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
});
export type UserDto = z.infer<typeof userDto>;
