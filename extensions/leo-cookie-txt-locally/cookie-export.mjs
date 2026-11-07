/**
 * Reading by url includes cookies set on a parent domain; reading by domain does not.
 * matchedBy tells callers that needed the url form that this extension version honoured it.
 */
export async function exportCookies(chromeApi, params = {}) {
  const details = params.url ? { url: params.url } : { domain: params.domain || "" };
  const cookies = await chromeApi.cookies.getAll(details);
  return { cookies, count: cookies.length, ...(params.url ? { matchedBy: "url" } : {}) };
}
