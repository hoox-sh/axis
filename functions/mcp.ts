/**
 * Same-origin `/mcp` for the edge-injected WebMCP bridge.
 *
 * `axis.hoox.sh` injects `/.webmcp/bridge.js` with `data-mcp-url="/mcp"`.
 * The MCP server lives on the Worker, not on Pages, so this function proxies
 * that path. pages.dev does not inject the bridge.
 */

const WORKER = 'https://worker.axis.hoox.sh';

export const onRequest = async (context: { request: Request }): Promise<Response> => {
  const incoming = new URL(context.request.url);
  const target = new URL(incoming.pathname + incoming.search, WORKER);
  const headers = new Headers(context.request.headers);
  headers.delete('host');
  return fetch(
    new Request(target.toString(), {
      method: context.request.method,
      headers,
      body: context.request.method === 'GET' || context.request.method === 'HEAD' ? undefined : context.request.body,
      redirect: 'manual',
    }),
  );
};
