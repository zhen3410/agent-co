import { UserRecord, UserStore } from '../infrastructure/user-store';

export interface PublicUserRecord {
  username: string;
  createdAt: number;
  updatedAt: number;
}

export interface UserAdminService {
  verifyCredentials(username: string, password: string): PublicUserRecord | null;
  listUsers(): PublicUserRecord[];
  createUser(username: string, password: string): PublicUserRecord;
  changePassword(username: string, password: string): PublicUserRecord;
  deleteUser(username: string): { username: string };
}

export class UserAdminServiceError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'UserAdminServiceError';
    this.statusCode = statusCode;
  }
}

export interface CreateUserAdminServiceOptions {
  userStore: UserStore;
}

function toPublicUser(user: UserRecord): PublicUserRecord {
  return {
    username: user.username,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

export function createUserAdminService(options: CreateUserAdminServiceOptions): UserAdminService {
  const { userStore } = options;

  return {
    verifyCredentials(username: string, password: string): PublicUserRecord | null {
      const user = userStore.findUser(username);
      if (!user || !userStore.verifyPassword(user, password || '')) {
        return null;
      }

      return toPublicUser(user);
    },

    listUsers(): PublicUserRecord[] {
      return userStore.listUsers().map(toPublicUser);
    },

    createUser(username: string, password: string): PublicUserRecord {
      const normalizedUsername = userStore.sanitizeUsername(username || '');
      const validationError = userStore.validateCredentialInput(normalizedUsername, password || '');
      if (validationError) {
        throw new UserAdminServiceError(400, validationError);
      }

      if (userStore.findUser(normalizedUsername)) {
        throw new UserAdminServiceError(409, '用户名已存在');
      }

      return toPublicUser(userStore.createUser(normalizedUsername, password));
    },

    changePassword(username: string, password: string): PublicUserRecord {
      if ((password || '').length < 8) {
        throw new UserAdminServiceError(400, '密码长度不能少于 8 位');
      }

      const updated = userStore.updatePassword(username, password);
      if (!updated) {
        throw new UserAdminServiceError(404, '用户不存在');
      }

      return toPublicUser(updated);
    },

    deleteUser(username: string): { username: string } {
      const users = userStore.listUsers();
      if (users.length <= 1) {
        throw new UserAdminServiceError(400, '至少保留一个用户，无法删除');
      }

      const normalizedUsername = userStore.sanitizeUsername(username || '');
      if (!userStore.deleteUser(normalizedUsername)) {
        throw new UserAdminServiceError(404, '用户不存在');
      }

      return { username: normalizedUsername };
    }
  };
}
