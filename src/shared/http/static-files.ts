import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { sendNotFound } from './json';

interface ServeStaticFileOptions {
  rootDir: string;
  filePath: string;
  contentType: string;
  disableHtmlCache?: boolean;
  onNotFound?: (res: http.ServerResponse) => void;
}

export function serveStaticFile(res: http.ServerResponse, options: ServeStaticFileOptions): void {
  const fullPath = path.join(options.rootDir, options.filePath);

  fs.readFile(fullPath, (error, data) => {
    if (error) {
      (options.onNotFound || sendNotFound)(res);
      return;
    }

    const headers: http.OutgoingHttpHeaders = { 'Content-Type': options.contentType };
    if (options.disableHtmlCache && options.contentType.startsWith('text/html')) {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    }

    res.writeHead(200, headers);
    res.end(data);
  });
}
