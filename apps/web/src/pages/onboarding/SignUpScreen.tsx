import { useState } from 'react';
import { useI18n } from '../../i18n/index.js';
import { Button } from '../../design-system/Button.js';
import { Stack } from '../../design-system/Stack.js';
import { TextField } from '../../design-system/TextField.js';
import { Screen } from '../../design-system/Screen.js';
import { Banner } from '../../design-system/Feedback.js';

export function SignUpScreen({ address, onSubmit }: { address: string; onSubmit: (email: string, password: string) => Promise<void> }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <Screen>
      <Stack gap={5}>
        <Stack gap={2}>
          <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 800 }}>{t('onboarding', 'accountStepTitle')}</h2>
          <p style={{ color: 'var(--color-text-muted)' }}>{t('onboarding', 'accountStepBody')}</p>
        </Stack>
        {error && <Banner tone="danger">{error}</Banner>}
        <TextField label={t('onboarding', 'email')} type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label={t('onboarding', 'passwordLabel')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button busy={busy} disabled={!email || password.length < 8} onClick={handleSubmit}>
          {t('onboarding', 'signUp')}
        </Button>
        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)' }}>
          {t('onboarding', 'receivingAddressNote')} <code>{address}</code>
        </p>
      </Stack>
    </Screen>
  );
}
