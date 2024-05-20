import { ReactNode, createContext } from 'react';
import { ImmerReducer, useImmerReducer } from 'use-immer';
import { AppReducerAction, AppReducerState } from '../../interfaces/app-reducer';

interface AppContextValue {
  state: AppReducerState;
  dispatch: React.Dispatch<AppReducerAction>;
}

export const AppContext = createContext<AppContextValue>({
  state: { items: [], people: [], owings: [] } as AppReducerState,
  dispatch: () => {},
});

interface AppProviderProps {
  children: ReactNode;
  reducer: ImmerReducer<AppReducerState, AppReducerAction>;
  initialState: AppReducerState;
}

export const AppContextProvider: React.FC<AppProviderProps> = ({
  children,
  initialState,
  reducer,
}) => {
  const [state, dispatch] = useImmerReducer(reducer, initialState);

  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>;
};
