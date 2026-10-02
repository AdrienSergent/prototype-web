import type { Role } from "@cir/shared";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        sessionId: string;
        userId: string;
        email: string;
        fullName: string;
        mfaEnabled: boolean;
        mfaVerified: boolean;
        activeCompanyId: string | null;
        csrfToken: string;
      };
      company?: {
        companyId: string;
        role: Role;
        accessExpiresAt: string | null;
      };
      rawBody?: Buffer;
    }
  }
}

export {};
