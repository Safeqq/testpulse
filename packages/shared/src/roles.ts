export const ROLES = ["admin", "tester", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const INVITABLE_ROLES = ["tester", "viewer"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const VISIBILITIES = ["private", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

const ROLE_RANK: Record<Role, number> = { admin: 3, tester: 2, viewer: 1 };

export function roleRank(role: Role): number {
  return ROLE_RANK[role];
}
