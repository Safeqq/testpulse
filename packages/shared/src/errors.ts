export type ErrorCode =
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "PROJECT_NOT_FOUND"
  | "MEMBER_NOT_FOUND"
  | "INVITATION_NOT_FOUND"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "EMAIL_TAKEN"
  | "INVALID_CREDENTIALS"
  | "SLUG_TAKEN"
  | "CONFIRMATION_MISMATCH"
  | "LAST_ADMIN"
  | "ALREADY_MEMBER"
  | "INVITATION_USED"
  | "INVITATION_EXPIRED";

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    fields?: Record<string, string>;
  };
}
