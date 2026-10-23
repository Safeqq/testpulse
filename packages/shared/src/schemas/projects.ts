import { z } from "zod";
import { ROLES, VISIBILITIES } from "../roles.js";
import { slugSchema } from "../slug.js";
import { nameField } from "./auth.js";

export const createProjectBody = z.object({
  name: nameField,
  slug: slugSchema.optional(),
});
export type CreateProjectBody = z.infer<typeof createProjectBody>;

export const updateProjectBody = z
  .object({
    name: nameField.optional(),
    visibility: z.enum(VISIBILITIES).optional(),
  })
  .refine((v) => v.name !== undefined || v.visibility !== undefined, "Minimal satu field harus diisi");
export type UpdateProjectBody = z.infer<typeof updateProjectBody>;

export const deleteProjectBody = z.object({
  confirmSlug: z.string(),
});
export type DeleteProjectBody = z.infer<typeof deleteProjectBody>;

export const projectDto = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  visibility: z.enum(VISIBILITIES),
  createdAt: z.string(),
  myRole: z.enum(ROLES).nullable(),
});
export type ProjectDto = z.infer<typeof projectDto>;
