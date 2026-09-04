import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

/**
 * 纯原生 HTTP/HTTPS 请求封装
 * @param {object|string} options 请求配置或完整 URL
 * @param {any} postBody 请求体 (字符串或 JSON 对象)
 * @returns {Promise<{statusCode: number, headers: object, raw: string, json: any}>}
 */
export function requestHttp(options, postBody = null) {
  return new Promise((resolve) => {
    let reqOptions = {};

    if (typeof options === 'string') {
      const parsedUrl = new URL(options);
      reqOptions = {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: postBody ? 'POST' : 'GET',
        headers: {}
      };
    } else {
      reqOptions = { ...options };
      if (!reqOptions.headers) reqOptions.headers = {};
    }

    const isHttps = reqOptions.protocol === 'https:' || reqOptions.port === 443;
    const client = isHttps ? https : http;

    const bodyStr = postBody
      ? (typeof postBody === 'string' ? postBody : JSON.stringify(postBody))
      : null;

    if (bodyStr) {
      reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyStr);
      if (!reqOptions.headers['Content-Type']) {
        reqOptions.headers['Content-Type'] = 'application/json;charset=UTF-8';
      }
    }

    const req = client.request({
      timeout: 10000,
      ...reqOptions
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch {}
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          data: json !== null ? json : raw,
          raw,
          json
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ statusCode: 504, headers: {}, raw: '', json: null, error: 'Request Timeout (10s)' });
    });

    req.on('error', (err) => {
      resolve({ statusCode: 500, headers: {}, raw: '', json: null, error: err.message });
    });

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

/**
 * 快速拉取 JSON API
 * @param {string} url 目标地址
 * @param {object} options 额外配置项
 * @returns {Promise<{success: boolean, status: number, data: any, error?: string}>}
 */
export async function fetchJson(url, options = {}) {
  const parsed = new URL(url);
  const res = await requestHttp({
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: options.method || 'GET',
    headers: options.headers || {}
  }, options.body);

  if (res.statusCode >= 200 && res.statusCode < 300) {
    return {
      success: true,
      status: res.statusCode,
      data: res.json !== null ? res.json : res.raw,
      headers: res.headers
    };
  }

  return {
    success: false,
    status: res.statusCode,
    data: res.json,
    raw: res.raw,
    error: res.error || `HTTP ${res.statusCode}`
  };
}
