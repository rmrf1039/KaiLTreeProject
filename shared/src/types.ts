export type ClientRole = 'input' | 'display';

export type TreeRecord = {
  treeId: string;
  dist: string;
  proxyUrl: string;
};

export const SEG_STRIDE = 7;
export const LEAF_STRIDE = 6;
export const RECT_STRIDE = 4;

export type SearchFailureReason =
  | 'invalid-code'
  | 'insufficient-photos'
  | 'timeout'
  | 'canceled';

export type WSMessage =
  | { type: 'snapshot'; currentTree: TreeReadyMessage | null; inputs: number; displays: number }
  | { type: 'search:started'; searchId: string; code: string }
  | { type: 'search:progress'; searchId: string; checked: number; found: number }
  | { type: 'search:failed'; searchId: string; reason: SearchFailureReason }
  | { type: 'tree-ready'; searchId: string; code: string; seed: number; trees: TreeRecord[]; fallbackSlots: number[] }
  | { type: 'display:rendering'; searchId: string }
  | { type: 'ping' }
  | { type: 'pong' };

export type TreeReadyMessage = Extract<WSMessage, { type: 'tree-ready' }>;

export type SubmitRequest = { code: string; idempotencyKey: string };
export type SubmitResponse = { status: 'accepted'; searchId: string };
