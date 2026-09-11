import { useState } from 'react';
import { useI18n } from '../../i18n/index.js';
import { Button } from '../../design-system/Button.js';
import { Stack } from '../../design-system/Stack.js';
import { TextField } from '../../design-system/TextField.js';
import { Screen } from '../../design-system/Screen.js';
import { Banner } from '../../design-system/Feedback.js';

const MIN_LENGTH = 8;

export function CreatePasswordScreen({ onBack, onSubmit }: { onBack: () => void; onSubmit: (passphrase: string) => Promise<void> }) {
  const { t } = useI18n();
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooShort = passphrase.length > 0 && passphrase.length < MIN_LENGTH;

  async function handleSubmit() {
    setError(null);
    setBusy(true);
    try {
      await onSubmit(passphrase);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen onBack={onBack}>
      <Stack gap={5}>
        <Stack gap={2}>
          <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 800 }}>{t('onboarding', 'passwordStepTitle')}</h2>
          <p style={{ color: 'var(--color-text-muted)' }}>{t('onboarding', 'passwordStepBody')}</p>
        </Stack>
        {error && <Banner tone="danger">{error}</Banner>}
        <TextField
          label={t('onboarding', 'passwordLabel')}
          type="password"
          autoFocus
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          hint={tooShort ? undefined : t('onboarding', 'passwordHint')}
          error={tooShort ? t('onboarding', 'passwordTooShort') : undefined}
        />
        <Button busy={busy} disabled={passphrase.length < MIN_LENGTH} onClick={handleSubmit}>
          {t('onboarding', 'generateWallet')}
        </Button>
      </Stack>
    </Screen>
  );
}
