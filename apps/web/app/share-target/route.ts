// Reached only when no service worker took the share (first launch before it installed, or a
// browser without one): the files are not read, and the visitor lands on the app, where a notice explains.
// A relative Location keeps the host whatever proxy is in front.
function toUpload() {
  return new Response(null, {
    status: 303,
    headers: { Location: "/app?shared=unavailable", "Cache-Control": "no-store" },
  });
}

export const POST = toUpload;
export const GET = toUpload;
