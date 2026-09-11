import { createContext, useContext, useState, type ReactNode } from 'react';
import * as api from '../apiClient.js';

interface SessionContextValue {
  session: api.SessionResult;
  appConfig: api.AppPublicConfig;
  logOut: () => void;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({
  initialSession,
  appConfig,
  onLogOut,
  children,
}: {
  initialSession: api.SessionResult;
  appConfig: api.AppPublicConfig;
  onLogOut: () => void;
  children: ReactNode;
}) {
  const [session] = useState(initialSession);
  return <SessionContext.Provider value={{ session, appConfig, logOut: onLogOut }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
