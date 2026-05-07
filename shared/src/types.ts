import type { SpeciesConfig } from './species/types.js';

export type ClientRole = 'input' | 'display';

export type TreeRecord = {
  treeId: string;
  dist: string;
  region: string;
  regionRemark: string;
  treeType: string;
  diameter: number | null;
  treeHeight: number | null;
  surveyDate: string;
  twd97x: number | null;
  twd97y: number | null;
  proxyUrl: string;
};

export const SEG_STRIDE = 10;
export const LEAF_STRIDE = 7;
export const RECT_STRIDE = 4;

export type SearchFailureReason =
  | 'invalid-code'
  | 'insufficient-photos'
  | 'timeout'
  | 'canceled';

export type LifecycleState =
  | { kind: 'idle' }
  | { kind: 'querying'; sessionId: string; code: string; checked: number; found: number }
  | { kind: 'generating'; sessionId: string; code: string }
  | { kind: 'prompting'; sessionId: string; code: string; deadlineEpochMs: number }
  | { kind: 'archiving'; sessionId: string; code: string; deadlineEpochMs: number }
  | { kind: 'resetting'; sessionId: string };

export type LifecycleIntent =
  | { kind: 'submit'; code: string }
  | { kind: 'query-progress'; sessionId: string; checked: number; found: number }
  | { kind: 'tree-resolved'; sessionId: string }
  | { kind: 'render-started'; sessionId: string }
  | { kind: 'consent:granted'; sessionId: string }
  | { kind: 'consent:denied'; sessionId: string }
  | { kind: 'capture-uploaded'; sessionId: string }
  | { kind: 'capture-failed'; sessionId: string }
  | { kind: 'search-failed'; sessionId: string }
  | { kind: 'timeout'; sessionId: string };

export type WSMessage =
  | { type: 'snapshot'; currentTree: TreeReadyMessage | null; lifecycle: LifecycleState; inputs: number; displays: number }
  | { type: 'search:started'; searchId: string; code: string }
  | { type: 'search:progress'; searchId: string; checked: number; found: number }
  | { type: 'search:failed'; searchId: string; reason: SearchFailureReason }
  | { type: 'tree-ready'; searchId: string; code: string; seed: number; trees: TreeRecord[]; fallbackSlots: number[]; speciesConfig: SpeciesConfig }
  | { type: 'display:rendering'; searchId: string }
  | { type: 'lifecycle:transition'; state: LifecycleState }
  | { type: 'lifecycle:dispatch'; intent: LifecycleIntent }
  | { type: 'meta-tree:updated' }
  | { type: 'screensaver:play' }
  | { type: 'ping' }
  | { type: 'pong' };

export type TreeReadyMessage = Extract<WSMessage, { type: 'tree-ready' }>;

export type SubmitRequest = { code: string; idempotencyKey: string };
export type SubmitResponse = { status: 'accepted'; searchId: string };
