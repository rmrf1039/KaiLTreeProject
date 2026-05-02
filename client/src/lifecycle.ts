import { useCallback, useEffect, useState } from 'react';
import type { LifecycleIntent, LifecycleState, WSMessage } from '../../shared/src/types';

type Sender = (msg: WSMessage) => void;
type Subscribe = (fn: (m: WSMessage) => void) => () => void;

/**
 * Mirror of the server-side lifecycle FSM. Both views derive their UI from
 * this state — nothing in the client mutates lifecycle locally.
 *
 * Pass the {subscribe, send} pair from `useWebSocket(role)`. Returns the
 * current state and a `dispatch(intent)` that wraps the intent in a
 * `lifecycle:dispatch` message — the server enforces the whitelist of
 * client-allowed intents (consent + capture-failed only).
 */
export function useLifecycle(subscribe: Subscribe, send: Sender): {
  state: LifecycleState;
  dispatch: (intent: LifecycleIntent) => void;
} {
  const [state, setState] = useState<LifecycleState>({ kind: 'idle' });

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'snapshot') {
        setState(msg.lifecycle);
      } else if (msg.type === 'lifecycle:transition') {
        setState(msg.state);
      }
    });
  }, [subscribe]);

  const dispatch = useCallback(
    (intent: LifecycleIntent) => {
      send({ type: 'lifecycle:dispatch', intent });
    },
    [send],
  );

  return { state, dispatch };
}
