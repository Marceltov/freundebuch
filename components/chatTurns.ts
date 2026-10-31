// What of a chat goes to the server with the next message: its last turns, at most MAX_TURNS and MAX_CHARS together (the limits
// of backend/chat/chat-route.ts), starting with one of the user's, as the Claude API wants. The whole chat stays on the device.
const MAX_TURNS = 40;
const MAX_CHARS = 250_000;

export type Turn = { role: "user" | "assistant"; content: string; filed?: boolean };

export function recentTurns<T extends Turn>(turns: T[]): T[] {
  let from = Math.max(0, turns.length - MAX_TURNS);
  let chars = turns.slice(from).reduce((n, t) => n + t.content.length, 0);
  while (from < turns.length - 1 && (chars > MAX_CHARS || turns[from].role !== "user")) chars -= turns[from++].content.length;
  return turns.slice(from);
}
