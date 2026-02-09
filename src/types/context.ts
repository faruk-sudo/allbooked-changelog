export type UserRole = "ADMIN" | "USER";

export interface AuthContext {
  userId: string;
  role: UserRole;
  isAuthenticated: boolean;
}

export interface ChangelogPost {
  id: string;
  slug: string;
  title: string;
  bodyMarkdown: string;
  status: "draft" | "published";
  publishedAt: string | null;
}
