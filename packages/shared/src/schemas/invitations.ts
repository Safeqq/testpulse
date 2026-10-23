import { z } from "zod";
import { INVITABLE_ROLES } from "../roles.js";

export const createInvitationBody = z.object({
  role: z.enum(INVITABLE_ROLES),
});
export type CreateInvitationBody = z.infer<typeof createInvitationBody>;

export const invitationDto = z.object({
  id: z.string(),
  role: z.enum(INVITABLE_ROLES),
  expiresAt: z.string(),
  createdAt: z.string(),
  createdBy: z.object({ id: z.string(), name: z.string() }),
});
export type InvitationDto = z.infer<typeof invitationDto>;

export const createdInvitationDto = z.object({
  id: z.string(),
  url: z.string(),
  role: z.enum(INVITABLE_ROLES),
  expiresAt: z.string(),
});
export type CreatedInvitationDto = z.infer<typeof createdInvitationDto>;

export const invitationPreviewDto = z.object({
  projectName: z.string(),
  projectSlug: z.string(),
  role: z.enum(INVITABLE_ROLES),
  expiresAt: z.string(),
});
export type InvitationPreviewDto = z.infer<typeof invitationPreviewDto>;

export const acceptInvitationDto = z.object({
  projectSlug: z.string(),
  role: z.enum(INVITABLE_ROLES),
});
export type AcceptInvitationDto = z.infer<typeof acceptInvitationDto>;
