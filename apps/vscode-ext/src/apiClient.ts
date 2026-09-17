import * as https from 'https';
import * as http from 'http';

export interface RedeemResult {
  id: number;
  email: string;
  token: string;
  soldAt: string;
}

export interface MyAccount {
  id: number;
  email: string;
  token: string;
  soldAt: string;
}

export class ApiClient {
  constructor(
    private baseUrl: string,
    private jwt: string,
  ) {}

  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const isHttps = url.protocol === 'https:';
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.jwt}`,
        } as Record<string, string>,
      };
      const payload = body ? JSON.stringify(body) : undefined;
      if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload).toString();

      const req = (isHttps ? https : http).request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.success === false) {
              reject(new Error(parsed.error || '请求失败'));
            } else {
              resolve((parsed.data ?? parsed) as T);
            }
          } catch {
            reject(new Error('响应解析失败'));
          }
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  redeem(): Promise<RedeemResult> {
    return this.request('POST', '/api/cursor-accounts/redeem');
  }

  myAccounts(): Promise<MyAccount[]> {
    return this.request('GET', '/api/cursor-accounts/mine');
  }
}
