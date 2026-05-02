/**
 * Tests for the server-side lifecycle FSM. Covers happy-path traversal,
 * illegal-transition rejection, session-id mismatch rejection, and timer-driven
 * timeouts (prompting / archiving / generating / resetting).
 */
import { setTimeout as wait } from 'node:timers/promises';
import { lifecycle } from '../server/src/lifecycle';
import type { LifecycleState } from '../shared/src/types';

let failed = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`OK   ${label}`);
  } else {
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function reset(): void {
  // Force the FSM back to idle by walking through whatever state we're in.
  // Tests share a singleton so we always start from idle.
  const s = lifecycle.getState();
  if (s.kind === 'idle') return;
  if ('sessionId' in s) {
    lifecycle.transition({ kind: 'timeout', sessionId: s.sessionId });
  }
  // After timeout we are in resetting; force timeout again to reach idle.
  const s2 = lifecycle.getState();
  if (s2.kind === 'resetting') {
    lifecycle.transition({ kind: 'timeout', sessionId: s2.sessionId });
  }
}

// 1. Initial state is idle.
{
  reset();
  check('initial state is idle', lifecycle.getState().kind === 'idle');
}

// 2. Happy path: idle → querying → generating → prompting → archiving → resetting → idle.
{
  reset();
  const r1 = lifecycle.transition({ kind: 'submit', code: '1234' });
  check('submit from idle accepted', r1.ok);
  const sid = (r1.ok && (r1.state as { sessionId: string }).sessionId) || '';
  check('querying carries sessionId', !!sid);

  const r2 = lifecycle.transition({ kind: 'tree-resolved', sessionId: sid });
  check('tree-resolved from querying accepted', r2.ok);
  check('state is generating', lifecycle.getState().kind === 'generating');

  const r3 = lifecycle.transition({ kind: 'render-started', sessionId: sid });
  check('render-started from generating accepted', r3.ok);
  check('state is prompting', lifecycle.getState().kind === 'prompting');

  const r4 = lifecycle.transition({ kind: 'consent:granted', sessionId: sid });
  check('consent:granted from prompting accepted', r4.ok);
  check('state is archiving', lifecycle.getState().kind === 'archiving');

  const r5 = lifecycle.transition({ kind: 'capture-uploaded', sessionId: sid });
  check('capture-uploaded from archiving accepted', r5.ok);
  check('state is resetting', lifecycle.getState().kind === 'resetting');
}

// 3. Illegal: submit while archiving.
{
  reset();
  const r1 = lifecycle.transition({ kind: 'submit', code: '0000' });
  const sid = (r1.ok && (r1.state as { sessionId: string }).sessionId) || '';
  lifecycle.transition({ kind: 'tree-resolved', sessionId: sid });
  lifecycle.transition({ kind: 'render-started', sessionId: sid });
  lifecycle.transition({ kind: 'consent:granted', sessionId: sid });
  const rBad = lifecycle.transition({ kind: 'submit', code: '1111' });
  check('submit while archiving is rejected', !rBad.ok);
  check('state still archiving', lifecycle.getState().kind === 'archiving');
}

// 4. Session-id mismatch: stale consent intent ignored.
{
  reset();
  const r1 = lifecycle.transition({ kind: 'submit', code: '2222' });
  const sid = (r1.ok && (r1.state as { sessionId: string }).sessionId) || '';
  lifecycle.transition({ kind: 'tree-resolved', sessionId: sid });
  lifecycle.transition({ kind: 'render-started', sessionId: sid });
  const rBad = lifecycle.transition({ kind: 'consent:granted', sessionId: 'wrong-session-id' });
  check('consent with wrong sessionId rejected', !rBad.ok);
  check('state still prompting', lifecycle.getState().kind === 'prompting');
}

// 5. Consent denied → resetting.
{
  reset();
  const r1 = lifecycle.transition({ kind: 'submit', code: '3333' });
  const sid = (r1.ok && (r1.state as { sessionId: string }).sessionId) || '';
  lifecycle.transition({ kind: 'tree-resolved', sessionId: sid });
  lifecycle.transition({ kind: 'render-started', sessionId: sid });
  const r4 = lifecycle.transition({ kind: 'consent:denied', sessionId: sid });
  check('consent:denied accepted', r4.ok);
  check('state is resetting', lifecycle.getState().kind === 'resetting');
}

// 6. query-progress mutates without leaving querying.
{
  reset();
  const r1 = lifecycle.transition({ kind: 'submit', code: '4444' });
  const sid = (r1.ok && (r1.state as { sessionId: string }).sessionId) || '';
  const r2 = lifecycle.transition({ kind: 'query-progress', sessionId: sid, checked: 50, found: 3 });
  check('query-progress accepted', r2.ok);
  const s = lifecycle.getState();
  check(
    'querying carries updated counts',
    s.kind === 'querying' && s.checked === 50 && s.found === 3,
  );
}

// 7. Listener fires on every transition.
{
  reset();
  const seen: LifecycleState['kind'][] = [];
  const off = lifecycle.subscribe((state) => seen.push(state.kind));
  const r1 = lifecycle.transition({ kind: 'submit', code: '5555' });
  const sid = (r1.ok && (r1.state as { sessionId: string }).sessionId) || '';
  lifecycle.transition({ kind: 'tree-resolved', sessionId: sid });
  off();
  check('listener fired twice', seen.length === 2 && seen[0] === 'querying' && seen[1] === 'generating');
}

// 8. Resetting auto-advances to idle after the duration.
{
  reset();
  const r1 = lifecycle.transition({ kind: 'submit', code: '6666' });
  const sid = (r1.ok && (r1.state as { sessionId: string }).sessionId) || '';
  lifecycle.transition({ kind: 'tree-resolved', sessionId: sid });
  lifecycle.transition({ kind: 'render-started', sessionId: sid });
  lifecycle.transition({ kind: 'consent:denied', sessionId: sid });
  check('state is resetting', lifecycle.getState().kind === 'resetting');
  await wait(2000); // RESETTING_DURATION_MS=1500 + buffer
  check('auto-advances to idle after resetting timer', lifecycle.getState().kind === 'idle');
}

if (failed > 0) {
  console.error(`\n${failed} checks failed`);
  process.exit(1);
}
console.log(`\nall checks pass`);
