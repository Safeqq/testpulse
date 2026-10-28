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
  | "INVITATION_EXPIRED"
  | "RUN_NOT_FOUND"
  | "TEST_NOT_FOUND"
  | "TOKEN_NOT_FOUND"
  | "TOKEN_LIMIT"
  | "PAYLOAD_TOO_LARGE"
  | "INVALID_REPORT";

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    fields?: Record<string, string>;
  };
}
