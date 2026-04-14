export interface UserDraftInput {
  username: string;
  password?: string;
}

export function normalizeUserDraft(input: UserDraftInput): UserDraftInput {
  return {
    username: input.username.trim(),
    password: input.password
  };
}
