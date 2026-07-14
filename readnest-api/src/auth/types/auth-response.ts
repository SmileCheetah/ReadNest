export type AuthResponse = {
  accessToken: string;
  user: {
    id: string;
    email: string;
    nickname: string;
    createdAt: Date;
    updatedAt: Date;
  };
};
