import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface UserRecord {
  username: string;
  passwordHash: string;
  salt: string;
  createdAt: number;
  updatedAt: number;
}

export interface UserStoreData {
  users: UserRecord[];
}

export interface CreateUserStoreOptions {
  dataFile: string;
  defaultUsername: string;
  defaultPassword: string;
}

export interface UserStore {
  getDataFile(): string;
  sanitizeUsername(username: string): string;
  validateCredentialInput(username: string, password: string): string | null;
  listUsers(): UserRecord[];
  findUser(username: string): UserRecord | null;
  createUser(username: string, password: string): UserRecord;
  updatePassword(username: string, password: string): UserRecord | null;
  deleteUser(username: string): boolean;
  verifyPassword(user: UserRecord, password: string): boolean;
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
}

function createUserRecord(username: string, password: string): UserRecord {
  const salt = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  return {
    username,
    salt,
    passwordHash: hashPassword(password, salt),
    createdAt: now,
    updatedAt: now
  };
}

function ensureDataDirExists(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function sanitizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function validateCredentialInput(username: string, password: string): string | null {
  if (!username || username.length < 3 || username.length > 32) {
    return '用户名长度需在 3-32 字符之间';
  }

  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return '用户名仅支持字母、数字、_.-';
  }

  if (!password || password.length < 8) {
    return '密码长度不能少于 8 位';
  }

  return null;
}

function findUserIndex(store: UserStoreData, username: string): number {
  const normalizedUsername = sanitizeUsername(username);
  return store.users.findIndex(entry => sanitizeUsername(entry.username) === normalizedUsername);
}

export function createUserStore(options: CreateUserStoreOptions): UserStore {
  function loadStore(): UserStoreData {
    ensureDataDirExists(options.dataFile);

    if (!fs.existsSync(options.dataFile)) {
      const initial: UserStoreData = {
        users: [createUserRecord(options.defaultUsername, options.defaultPassword)]
      };
      fs.writeFileSync(options.dataFile, JSON.stringify(initial, null, 2), 'utf-8');
      console.log(`[AuthAdmin] 初始化用户完成，默认账号: ${options.defaultUsername}`);
      return initial;
    }

    const raw = fs.readFileSync(options.dataFile, 'utf-8');
    const parsed = raw ? JSON.parse(raw) as UserStoreData : { users: [] };

    if (!Array.isArray(parsed.users)) {
      throw new Error('Invalid users.json structure');
    }

    return parsed;
  }

  function saveStore(store: UserStoreData): void {
    ensureDataDirExists(options.dataFile);
    fs.writeFileSync(options.dataFile, JSON.stringify(store, null, 2), 'utf-8');
  }

  return {
    getDataFile(): string {
      return options.dataFile;
    },

    sanitizeUsername,

    validateCredentialInput,

    listUsers(): UserRecord[] {
      return loadStore().users.map(user => ({ ...user }));
    },

    findUser(username: string): UserRecord | null {
      const store = loadStore();
      const index = findUserIndex(store, username);
      const user = index === -1 ? null : store.users[index];
      return user ? { ...user } : null;
    },

    createUser(username: string, password: string): UserRecord {
      const normalizedUsername = sanitizeUsername(username);
      const store = loadStore();
      const user = createUserRecord(normalizedUsername, password);
      store.users.push(user);
      saveStore(store);
      return { ...user };
    },

    updatePassword(username: string, password: string): UserRecord | null {
      const store = loadStore();
      const index = findUserIndex(store, username);
      const user = index === -1 ? null : store.users[index];
      if (!user) {
        return null;
      }

      user.salt = crypto.randomBytes(16).toString('hex');
      user.passwordHash = hashPassword(password, user.salt);
      user.updatedAt = Date.now();
      saveStore(store);
      return { ...user };
    },

    deleteUser(username: string): boolean {
      const store = loadStore();
      const index = findUserIndex(store, username);
      if (index === -1) {
        return false;
      }

      store.users.splice(index, 1);
      saveStore(store);
      return true;
    },

    verifyPassword(user: UserRecord, password: string): boolean {
      return hashPassword(password, user.salt) === user.passwordHash;
    }
  };
}
