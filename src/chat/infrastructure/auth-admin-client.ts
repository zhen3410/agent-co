import * as http from 'http';

export interface VerifyCredentialsResult {
  success: boolean;
  error?: string;
}

export interface AuthAdminClient {
  verifyCredentials(username: string, password: string): Promise<VerifyCredentialsResult>;
}

export function createAuthAdminClient(baseUrl: string): AuthAdminClient {
  return {
    verifyCredentials(username: string, password: string): Promise<VerifyCredentialsResult> {
      return new Promise((resolve, reject) => {
        const targetUrl = new URL('/api/auth/verify', baseUrl);
        const payload = JSON.stringify({ username, password });

        const request = http.request({
          hostname: targetUrl.hostname,
          port: targetUrl.port,
          path: targetUrl.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          timeout: 3000
        }, response => {
          let responseBody = '';
          response.on('data', chunk => (responseBody += chunk));
          response.on('end', () => {
            try {
              const data = responseBody ? JSON.parse(responseBody) as Partial<VerifyCredentialsResult> : {};
              if (response.statusCode === 200 && data.success) {
                resolve({ success: true });
                return;
              }

              resolve({ success: false, error: data.error || '鉴权失败' });
            } catch {
              resolve({ success: false, error: '鉴权服务返回格式错误' });
            }
          });
        });

        request.on('timeout', () => {
          request.destroy(new Error('鉴权服务超时'));
        });

        request.on('error', err => {
          reject(new Error(`鉴权服务不可用: ${err.message}`));
        });

        request.write(payload);
        request.end();
      });
    }
  };
}
