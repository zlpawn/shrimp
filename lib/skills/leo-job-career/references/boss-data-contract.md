# BOSS Data Contract

## Endpoints
- Search list: `https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json`
  - Query parameters: `city=101010100`, `query=<string>`, `page=<int>`, `pageSize=30`
- Job detail: `https://www.zhipin.com/wapi/zpgeek/job/detail.json`
  - Query parameters: `securityId=<string>`, `lid=<string>`, `jobId=<string>`

## Security and Auth Status Codes
- `code: 0` / `code: 200`: Success
- `code: 37`: Security check / Slider captcha required
- `code: 1` / `code: 100` / `message: 未登录`: Session expired or missing Cookie Header
- `code: 9`: Rate limited / Request too frequent
