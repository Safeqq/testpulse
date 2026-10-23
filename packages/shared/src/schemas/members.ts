import { z } from "zod";
import { ROLES } from "../roles.js";

export const updateMemberBody = z.object({
  role: z.enum(ROLES),
});
export type UpdateMemberBody = z.infer<typeof updateMemberBody>;

export const memberDto = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  joinedAt: z.string(),
});
export type MemberDto = z.infer<typeof memberDto>;
