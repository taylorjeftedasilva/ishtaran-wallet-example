import { useState } from 'react';
import { useI18n } from '../../i18n/index.js';
import { Button } from '../../design-system/Button.js';
import { Stack } from '../../design-system/Stack.js';
import { TextField } from '../../design-system/TextField.js';
import { Screen } from '../../design-system/Screen.js';
import { Banner } from '../../design-system/Feedback.js';

export function RestorePhraseScreen({
  onBack,
  onSubmit,
}: {
  onBack: () => void;
  onSubmit: (mnemonic: string, passphrase: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [mnemonic, setMnemonic] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wordCount = mnemonic.trim().split(/\s+/).filter(Boolean).length;
  const looksValid = wordCount === 12 || wordCount === 24;

  async function handleSubmit() {
    setError(null);
    setBusy(true);
    try {
      await onSubmit(mnemonic.trim().toLowerCase(), passphrase);
    } catch {
      setError(t('onboarding', 'restoreInvalid'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen onBack={onBack}>
      <Stack gap={5}>
        <Stack gap={2}>
          <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 800 }}>{t('onboarding', 'restoreTitle')}</h2>
          <p style={{ color: 'var(--color-text-muted)' }}>{t('onboarding', 'restoreBody')}</p>
        </Stack>
        {error && <Banner tone="danger">{error}</Banner>}
        <div>
          <textarea
            aria-label={t('onboarding', 'restoreTitle')}
            placeholder={t('onboarding', 'restorePlaceholder')}
            value={mnemonic}
            onChange={(e) => setMnemonic(e.target.value)}
            rows={3}
            style={{
              width: '100%',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--font-size-md)',
              padding: 14,
              borderRadius: 'var(--radius-sm)',
              border: '1.5px solid var(--color-border)',
              resize: 'vertical',
            }}
          />
        </div>
        <TextField label={t('onboarding', 'passwordLabel')} type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} hint={t('onboarding', 'passwordHint')} />
        <Button busy={busy} disabled={!looksValid || passphrase.length < 8} onClick={handleSubmit}>
          {t('onboarding', 'restoreSubmit')}
        </Button>
      </Stack>
    </Screen>
  );
}
