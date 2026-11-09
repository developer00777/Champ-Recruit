export type PublishMessage =
  | { kind: 'publish'; postingId: string }
  | { kind: 'close'; postingId: string }
  | { kind: 'update'; postingId: string }
  | { kind: 'webhook'; endpointId: string; event: string; payload: Record<string, unknown> };
