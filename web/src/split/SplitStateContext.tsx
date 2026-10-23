import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';
import { useImmerReducer } from 'use-immer';
import type { SplitAction, SplitState } from './state';
import { splitReducer } from './state';

interface SplitStateContextValue {
  state: SplitState;
  dispatch: React.Dispatch<SplitAction>;
}

const SplitStateContext = createContext<SplitStateContextValue | null>(null);

const EMPTY: SplitState = { people: [], items: [], payments: [] };

/** The open split's bill; mounted with its page (keyed by the split), so each starts empty */
export const SplitStateProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useImmerReducer(splitReducer, EMPTY);
  return (
    <SplitStateContext.Provider value={{ state, dispatch }}>{children}</SplitStateContext.Provider>
  );
};

/** The open split's bill and how to change it, inside SplitStateProvider */
export function useSplitState(): SplitStateContextValue {
  const value = useContext(SplitStateContext);
  if (value == null) throw new Error('useSplitState is only for inside SplitStateProvider');
  return value;
}
