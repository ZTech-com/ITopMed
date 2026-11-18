import { boardForToken } from "@/server/queue/board";

/**
 * Waiting-room screen data (polled every few seconds by /tv/<secret>).
 * Public by design: the screen has no user; the secret in the link is the
 * credential (only its hash is stored; revoked screens get 404). Only today's
 * queue of the screen's branch: number, short name, cabinet, state.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const board = await boardForToken(token);
  if (!board) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return Response.json(board, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
