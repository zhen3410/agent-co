import * as http from 'http';

export function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

export function sendText(res: http.ServerResponse, statusCode: number, text: string): void {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

export function sendNotFound(res: http.ServerResponse, message = 'Not Found'): void {
  res.writeHead(404);
  res.end(message);
}
