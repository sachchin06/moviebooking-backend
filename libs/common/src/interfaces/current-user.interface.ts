export interface ICurrentUser {
  id: number;
  email: string;
  name: string;
  role: {
    id: number;
    code: string;
    name: string;
  };
  theatreId?: number;
  /** Set while the user still has to replace a temporary password. */
  mustChangePassword?: boolean;
}
