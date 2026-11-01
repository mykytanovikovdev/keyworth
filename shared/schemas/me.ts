/**
 * What `GET /api/me` returns: the signed-in user, and how long the session
 * still counts as a recent sign-in. Replacing a wrapped key needs one, so the
 * browser asks for a fresh Google sign-in before anything secret is typed
 * rather than after the server refuses.
 */
export interface MeJson {
  id: string;
  name: string;
  email: string;
  /** Seconds left; 0 when a fresh sign-in is needed. */
  freshForSeconds: number;
}
