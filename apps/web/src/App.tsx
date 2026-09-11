import { useEffect, useState, type ReactNode } from 'react';
import * as api from './apiClient.js';
import { hasWallet, getReceivingAddress } from './wallet/localWallet.js';
import { I18nProvider } from './i18n/index.js';
import { SessionProvider, useSession } from './state/SessionContext.js';
import { NavShell } from './navigation/NavShell.js';
import type { AppRoute } from './navigation/routes.js';
import { OnboardingFlow } from './pages/onboarding/OnboardingFlow.js';
import { LoginScreen } from './pages/onboarding/LoginScreen.js';
import { HomePage } from './pages/Home.js';
import { MoveFlow } from './pages/move/MoveFlow.js';
import type { MoveMode } from './pages/move/SegmentedTabs.js';
import { ReceivePage } from './pages/receive/ReceivePage.js';
import { ActivityPage } from './pages/activity/ActivityPage.js';
import { RevenuePage } from './pages/revenue/RevenuePage.js';
import { SettingsPage } from './pages/settings/SettingsPage.js';
import { Spinner } from './design-system/Feedback.js';
import './styles/global.css';

type BootState = { phase: 'loading' } | { phase: 'onboarding' } | { phase: 'login' } | { phase: 'ready'; session: api.SessionResult; appConfig: api.AppPublicConfig };

export function App() {
  const [boot, setBoot] = useState<BootState>({ phase: 'loading' });

  useEffect(() => {
    (async () => {
      const [walletExists, appConfig] = await Promise.all([hasWallet(), api.getAppConfig()]);
      const token = api.getSessionToken();
      if (walletExists && token) {
        // SessionProvider only ever reads its `initialSession` prop once (useState's lazy
        // initializer) -- so the full, real session must be resolved BEFORE the first 'ready'
        // setBoot, never patched in after the fact.
        try {
          const address = await getReceivingAddress();
          const me = await fetchMe(token, address);
          setBoot({ phase: 'ready', session: { sessionToken: token, ...me }, appConfig });
        } catch {
          api.clearSessionToken();
          setBoot({ phase: 'login' });
        }
      } else if (walletExists) {
        setBoot({ phase: 'login' });
      } else {
        setBoot({ phase: 'onboarding' });
      }
    })();
  }, []);

  if (boot.phase === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spinner />
      </div>
    );
  }

  return (
    <I18nProvider>
      <AppBody boot={boot} setBoot={setBoot} />
    </I18nProvider>
  );
}

function fetchMe(token: string, address?: string): Promise<{ userId: string; accountId: string; email: string; walletAddress: string | null }> {
  const base = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:3001';
  const query = address ? `?address=${encodeURIComponent(address)}` : '';
  return fetch(`${base}/auth/me${query}`, { headers: { authorization: `Bearer ${token}` } }).then((res) => {
    if (!res.ok) throw new Error('session invalid');
    return res.json();
  });
}

function AppBody({ boot, setBoot }: { boot: Exclude<BootState, { phase: 'loading' }>; setBoot: (b: BootState) => void }) {
  if (boot.phase === 'onboarding') {
    return (
      <OnboardingFlow
        onAuthenticated={async (session) => {
          const appConfig = await api.getAppConfig();
          setBoot({ phase: 'ready', session, appConfig });
        }}
      />
    );
  }

  if (boot.phase === 'login') {
    return (
      <LoginScreen
        onSubmit={async (email, password) => {
          const address = await getReceivingAddress();
          const result = await api.login(email, password, address);
          api.setSessionToken(result.sessionToken);
          const appConfig = await api.getAppConfig();
          setBoot({ phase: 'ready', session: result, appConfig });
        }}
        onStartOver={() => setBoot({ phase: 'onboarding' })}
      />
    );
  }

  return (
    <SessionProvider initialSession={boot.session} appConfig={boot.appConfig} onLogOut={() => setBoot({ phase: 'onboarding' })}>
      <AuthenticatedApp onLoggedOut={() => setBoot({ phase: 'onboarding' })} />
    </SessionProvider>
  );
}

function AuthenticatedApp({ onLoggedOut }: { onLoggedOut: () => void }) {
  const { appConfig } = useSession();
  const [route, setRoute] = useState<AppRoute>('home');
  const [moveMode, setMoveMode] = useState<MoveMode>('send');
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = () => setRefreshKey((k) => k + 1);

  function navigateToMove(mode: MoveMode) {
    setMoveMode(mode);
    setRoute('send');
  }

  let page: ReactNode;
  if (route === 'home') page = <HomePage onNavigate={setRoute} onNavigateToMove={navigateToMove} refreshKey={refreshKey} />;
  else if (route === 'send')
    page = <MoveFlow initialMode={moveMode} onBackToHome={() => setRoute('home')} onCompleted={bumpRefresh} onGoToSandboxTools={() => setRoute('settings')} />;
  else if (route === 'receive') page = <ReceivePage onDataChanged={bumpRefresh} />;
  else if (route === 'activity') page = <ActivityPage refreshKey={refreshKey} />;
  else if (route === 'revenue') page = <RevenuePage />;
  else page = <SettingsPage onLoggedOut={onLoggedOut} onDataChanged={bumpRefresh} />;

  return (
    <NavShell active={route} onNavigate={setRoute} showRevenue={appConfig.mode === 'MONETIZED'} appName={appConfig.appName}>
      {page}
    </NavShell>
  );
}
