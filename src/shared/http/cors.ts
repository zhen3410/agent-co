import * as http from 'http';

interface CorsOptions {
  methods: string[];
  headers: string[];
  credentials?: boolean;
}

function applyCorsHeaders(res: http.ServerResponse, options: CorsOptions): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', options.methods.join(', '));
  res.setHeader('Access-Control-Allow-Headers', options.headers.join(', '));
  if (options.credentials) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}

export function applyChatCorsHeaders(res: http.ServerResponse): void {
  applyCorsHeaders(res, {
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
    headers: [
      'Content-Type',
      'Authorization',
      'x-agent-co-callback-token',
      'x-agent-co-session-id',
      'x-agent-co-agent'
    ]
  });
}

export function applyAdminCorsHeaders(res: http.ServerResponse): void {
  applyCorsHeaders(res, {
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    headers: ['Content-Type', 'x-admin-token']
  });
}
