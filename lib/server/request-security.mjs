function firstHeaderValue(value) {
  return value?.split(",", 1)[0]?.trim() || null;
}

export function getRequestOrigin(request) {
  const url = new URL(request.url);
  const protocol = firstHeaderValue(request.headers.get("x-forwarded-proto")) || url.protocol.slice(0, -1);
  const host = firstHeaderValue(request.headers.get("x-forwarded-host")) || request.headers.get("host") || url.host;
  return `${protocol}://${host}`;
}

export function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== getRequestOrigin(request)) {
    const error = new Error("跨站写入已拒绝");
    error.status = 403;
    throw error;
  }
}

export function getClientAddress(request) {
  return firstHeaderValue(request.headers.get("x-forwarded-for"))
    || request.headers.get("x-real-ip")
    || "unknown";
}
