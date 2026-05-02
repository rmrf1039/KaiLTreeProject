import crypto from 'node:crypto';
import type { LifecycleIntent, LifecycleState } from '../../shared/src/types.js';

const PROMPTING_TIMEOUT_MS = 30_000;
const ARCHIVING_TIMEOUT_MS = 20_000;
const GENERATING_TIMEOUT_MS = 60_000;
const RESETTING_DURATION_MS = 1_500;

export type LifecycleResult =
  | { ok: true; state: LifecycleState; prev: LifecycleState }
  | { ok: false; error: string };

type Listener = (state: LifecycleState, prev: LifecycleState) => void;

class LifecycleStore {
  private state: LifecycleState = { kind: 'idle' };
  private timer: NodeJS.Timeout | null = null;
  private listeners = new Set<Listener>();

  getState(): LifecycleState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  transition(intent: LifecycleIntent): LifecycleResult {
    const prev = this.state;
    const next = compute(prev, intent);
    if (!next) {
      return { ok: false, error: `illegal transition: ${prev.kind} + ${intent.kind}` };
    }
    this.clearTimer();
    this.state = next;
    this.armTimer();
    for (const fn of this.listeners) fn(this.state, prev);
    return { ok: true, state: this.state, prev };
  }

  private armTimer(): void {
    const sid = sessionIdOf(this.state);
    let ms = 0;
    switch (this.state.kind) {
      case 'idle':
      case 'querying':
        return;
      case 'generating':
        ms = GENERATING_TIMEOUT_MS;
        break;
      case 'prompting':
        ms = PROMPTING_TIMEOUT_MS;
        break;
      case 'archiving':
        ms = ARCHIVING_TIMEOUT_MS;
        break;
      case 'resetting':
        ms = RESETTING_DURATION_MS;
        break;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.transition({ kind: 'timeout', sessionId: sid });
    }, ms);
    this.timer.unref();
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

function sessionIdOf(state: LifecycleState): string {
  return 'sessionId' in state ? state.sessionId : '';
}

function compute(prev: LifecycleState, intent: LifecycleIntent): LifecycleState | null {
  switch (intent.kind) {
    case 'submit': {
      if (prev.kind !== 'idle' && prev.kind !== 'resetting') return null;
      return {
        kind: 'querying',
        sessionId: crypto.randomUUID(),
        code: intent.code,
        checked: 0,
        found: 0,
      };
    }
    case 'query-progress': {
      if (prev.kind !== 'querying') return null;
      if (intent.sessionId !== prev.sessionId) return null;
      return { ...prev, checked: intent.checked, found: intent.found };
    }
    case 'tree-resolved': {
      if (prev.kind !== 'querying') return null;
      if (intent.sessionId !== prev.sessionId) return null;
      return { kind: 'generating', sessionId: prev.sessionId, code: prev.code };
    }
    case 'render-started': {
      if (prev.kind !== 'generating') return null;
      if (intent.sessionId !== prev.sessionId) return null;
      return {
        kind: 'prompting',
        sessionId: prev.sessionId,
        code: prev.code,
        deadlineEpochMs: Date.now() + PROMPTING_TIMEOUT_MS,
      };
    }
    case 'consent:granted': {
      if (prev.kind !== 'prompting') return null;
      if (intent.sessionId !== prev.sessionId) return null;
      return {
        kind: 'archiving',
        sessionId: prev.sessionId,
        code: prev.code,
        deadlineEpochMs: Date.now() + ARCHIVING_TIMEOUT_MS,
      };
    }
    case 'consent:denied': {
      if (prev.kind !== 'prompting') return null;
      if (intent.sessionId !== prev.sessionId) return null;
      return { kind: 'resetting', sessionId: prev.sessionId };
    }
    case 'capture-uploaded':
    case 'capture-failed': {
      if (prev.kind !== 'archiving') return null;
      if (intent.sessionId !== prev.sessionId) return null;
      return { kind: 'resetting', sessionId: prev.sessionId };
    }
    case 'search-failed': {
      if (prev.kind !== 'querying') return null;
      if (intent.sessionId !== prev.sessionId) return null;
      return { kind: 'resetting', sessionId: prev.sessionId };
    }
    case 'timeout': {
      // Stale timer for an old session — ignore.
      if (sessionIdOf(prev) !== intent.sessionId && prev.kind !== 'idle') return null;
      switch (prev.kind) {
        case 'idle':
          return null;
        case 'resetting':
          return { kind: 'idle' };
        case 'querying':
        case 'generating':
        case 'prompting':
        case 'archiving':
          return { kind: 'resetting', sessionId: sessionIdOf(prev) };
      }
    }
  }
}

export const lifecycle = new LifecycleStore();

// Exposed only for client-driven intents that the FSM accepts. Server-internal
// intents (submit, tree-resolved, query-progress, render-started, search-failed,
// capture-uploaded, timeout) must come from authoritative server code paths.
export const CLIENT_DISPATCHABLE_INTENTS: ReadonlySet<LifecycleIntent['kind']> = new Set([
  'consent:granted',
  'consent:denied',
  'capture-failed',
]);
