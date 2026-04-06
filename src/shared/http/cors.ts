import * as http from 'http';

interface CorsOptions {
  methods: string[];
  headers: string[];
}

function applyCorsHeaders(res: http.ServerResponse, options: CorsOptions): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', options.methods.join(', '));
  res.setHeader('Access-Control-Allow-Headers', options.headers.join(', '));
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

export function applyChatCorsHeaders(res: http.ServerResponse): void {
  applyCorsHeaders(res, {
    methods: ['GET', 'POST', 'OPTIONS'],
    headers: [
      'Content-Type',
      'Authorization',
      'x-bot-room-callback-token',
      'x-bot-room-session-id',
      'x-bot-room-agent'
    ]
  });
}

export function applyAdminCorsHeaders(res: http.ServerResponse): void {
  applyCorsHeaders(res, {
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    headers: ['Content-Type', 'x-admin-token']
  });
}
