export const CURRENT_USER_ID =
  ((import.meta as any).env?.VITE_CURRENT_USER_ID as string | undefined)?.trim() || 'user-1';

export const getCurrentUserId = () => CURRENT_USER_ID;
