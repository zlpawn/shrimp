export class BossClientError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "BossClientError";
    this.code = code;
    this.details = details;
  }
}

export class BossClient {
  constructor(options = {}) {
    this.cookieHeader = options.cookieHeader || "";
    this.userAgent = options.userAgent || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
    this.fetchFn = options.fetchFn || globalThis.fetch.bind(globalThis);
    this.delayRangeMs = options.delayRangeMs || [1000, 2500];
  }

  async _delay() {
    const [min, max] = this.delayRangeMs;
    if (max <= 0) return;
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  _getHeaders(extra = {}) {
    const headers = {
      "User-Agent": this.userAgent,
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Referer": "https://www.zhipin.com/web/geek/jobs",
      "Sec-Ch-Ua": `"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"`,
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": `"macOS"`,
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      ...extra,
    };
    if (this.cookieHeader) {
      headers["Cookie"] = this.cookieHeader;
    }
    return headers;
  }

  _checkResponse(json, rawText, status) {
    if (status === 429) {
      throw new BossClientError("RATE_LIMITED", "HTTP 429 Too Many Requests from BOSS");
    }

    if (rawText && (rawText.includes("_security_check") || rawText.includes("verify-slider"))) {
      throw new BossClientError("SECURITY_CHECK_REQUIRED", "BOSS Zhipin requested verification check or slider.");
    }

    if (!json || typeof json !== "object") {
      throw new BossClientError("UPSTREAM_SCHEMA_CHANGED", "Invalid non-JSON response from BOSS");
    }

    // Code 37: Security Check
    if (json.code === 37) {
      throw new BossClientError("SECURITY_CHECK_REQUIRED", json.message || "Security check triggered (code 37).");
    }

    // Code 1 or 100 or message about login
    if (json.code === 1 || json.code === 100 || (json.message && /未登录|登录失效|重新登录/.test(json.message))) {
      throw new BossClientError("AUTH_REQUIRED", json.message || "BOSS session expired or login required.");
    }

    // Code 9 or rate limit
    if (json.code === 9 || (json.message && /频繁|稍后再试|限流/.test(json.message))) {
      throw new BossClientError("RATE_LIMITED", json.message || "Operation too frequent (rate limit).");
    }

    if (json.code !== 0 && json.code !== 200) {
      throw new BossClientError("UPSTREAM_ERROR", json.message || `Upstream returned code ${json.code}`, { code: json.code });
    }
  }

  async searchJobs(options = {}) {
    await this._delay();
    const city = options.city || "101010100"; // Beijing default
    const query = options.query || "Java Agent";
    const page = options.page || 1;
    const pageSize = options.pageSize || 30;

    const url = `https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json?city=${city}&query=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}`;

    let res;
    let rawText = "";
    try {
      res = await this.fetchFn(url, {
        method: "GET",
        headers: this._getHeaders(),
      });
      rawText = await res.text();
    } catch (err) {
      throw new BossClientError("NETWORK_ERROR", `Network request failed: ${err.message}`);
    }

    let json;
    try {
      json = JSON.parse(rawText);
    } catch {
      this._checkResponse(null, rawText, res.status);
    }

    this._checkResponse(json, rawText, res.status);

    const zp = json.zpData || json.data || {};
    const list = zp.jobList || zp.list || [];
    return {
      raw: json,
      jobList: list,
      hasMore: Boolean(zp.hasMore),
      totalCount: zp.totalCount || list.length,
    };
  }

  async getJobDetail(options = {}) {
    await this._delay();
    const securityId = options.securityId || "";
    const lid = options.lid || "";
    const jobId = options.jobId || options.encryptJobId || "";

    const url = `https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=${encodeURIComponent(securityId)}&lid=${encodeURIComponent(lid)}&jobId=${encodeURIComponent(jobId)}`;

    let res;
    let rawText = "";
    try {
      res = await this.fetchFn(url, {
        method: "GET",
        headers: this._getHeaders(),
      });
      rawText = await res.text();
    } catch (err) {
      throw new BossClientError("NETWORK_ERROR", `Network request failed: ${err.message}`);
    }

    let json;
    try {
      json = JSON.parse(rawText);
    } catch {
      this._checkResponse(null, rawText, res.status);
    }

    this._checkResponse(json, rawText, res.status);

    return json.zpData || json.data || {};
  }
}
