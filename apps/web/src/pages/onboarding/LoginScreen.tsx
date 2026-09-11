import { useState } from 'react';
import { useI18n } from '../../i18n/index.js';
import { forgetWallet } from '../../wallet/localWallet.js';
import { Button } from '../../design-system/Button.js';
import { Stack } from '../../design-system/Stack.js';
import { TextField } from '../../design-system/TextField.js';
import { Screen } from '../../design-system/Screen.js';
import { Banner } from '../../design-system/Feedback.js';

export function LoginScreen({ onSubmit, onStartOver }: { onSubmit: (email: string, password: string) => Promise<void>; onStartOver: () => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingStartOver, setConfirmingStartOver] = useState(false);

  async function handleSubmit() {
    setError(null);
    setBusy(true);
    try {
      await onSubmit(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleStartOver() {
    await forgetWallet();
    onStartOver();
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }}>
      <div style={{ width: '100%', maxWidth: 'var(--content-max-width)' }}>
        <Stack gap={5}>
          <Stack gap={2}>
            <h1 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 800 }}>{t('onboarding', 'loginTitle')}</h1>
            <p style={{ color: 'var(--color-text-muted)' }}>{t('onboarding', 'loginBody')}</p>
          </Stack>
          {error && <Banner tone="danger">{error}</Banner>}
          <TextField label={t('onboarding', 'email')} type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          <TextField label={t('onboarding', 'passwordLabel')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
          <Button busy={busy} disabled={!email || !password} onClick={handleSubmit}>
            {t('onboarding', 'logIn')}
          </Button>

          {!confirmingStartOver ? (
            <button
              onClick={() => setConfirmingStartOver(true)}
              style={{ background: 'none', border: 'none', color: 'var(--color-text-faint)', fontSize: 'var(--font-size-xs)' }}
            >
              {t('onboarding', 'startOverLink')}
            </button>
          ) : (
            <Stack gap={2}>
              <Banner tone="warning">{t('onboarding', 'startOverWarning')}</Banner>
              <Button variant="danger" compact onClick={handleStartOver}>
                {t('onboarding', 'startOverConfirm')}
              </Button>
            </Stack>
          )}
        </Stack>
      </div>
    </div>
  );
}
