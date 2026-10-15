import { ReactNode, createContext } from 'react';
import { ImmerReducer, useImmerReducer } from 'use-immer';
import { SplitAction, SplitState } from './state';

interface AppContextValue {
  state: SplitState;
  dispatch: React.Dispatch<SplitAction>;
}

export const SplitStateContext = createContext<AppContextValue>({
  state: { items: [], people: [] },
  dispatch: () => {},
});

interface AppProviderProps {
  children: ReactNode;
  reducer: ImmerReducer<SplitState, SplitAction>;
  initialState: SplitState;
}

export const SplitStateProvider: React.FC<AppProviderProps> = ({
  children,
  initialState,
  reducer,
}) => {
  const [state, dispatch] = useImmerReducer(reducer, initialState);

  return (
    <SplitStateContext.Provider value={{ state, dispatch }}>{children}</SplitStateContext.Provider>
  );
};
