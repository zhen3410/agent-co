import * as fs from 'fs';
import * as path from 'path';

export function isExistingAbsoluteDirectory(targetPath: string): boolean {
  return path.isAbsolute(targetPath) && fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
}
