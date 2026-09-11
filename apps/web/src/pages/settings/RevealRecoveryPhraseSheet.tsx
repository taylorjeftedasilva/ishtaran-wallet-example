import { useState } from 'react';
import { useI18n } from '../../i18n/index.js';
import { revealMnemonic } from '../../wallet/localWallet.js';
import { Sheet } from '../../design-system/Sheet.js';
import { Stack, Row } from '../../design-system/Stack.js';
import { Button } from '../../design-system/Button.js';
import { TextField } from '../../design-system/TextField.js';
import { Banner } from '../../design-system/Feedback.js';

export function RevealRecoveryPhraseSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [passphrase, setPassphrase] = useState('');
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReveal() {
    setError(null);
    setBusy(true);
    try {
      setMnemonic(await revealMnemonic(passphrase));
    } catch {
      setError(t('common', 'retry'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet onDismiss={onClose}>
      <Row justify="space-between">
        <span style={{ fontWeight: 700 }}>{t('settings', 'revealRecoveryPhrase')}</span>
        <button onClick={onClose} aria-label={t('common', 'close')} style={{ background: 'none', border: 'none', fontSize: 20 }}>
          ✕
        </button>
      </Row>
      <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>{t('settings', 'revealRecoveryPhraseBody')}</p>

      {!mnemonic ? (
        <Stack gap={3}>
          {error && <Banner tone="danger">{error}</Banner>}
          <TextField
            label={t('settings', 'enterPasswordToReveal')}
            type="password"
            autoFocus
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleReveal()}
          />
          <Button busy={busy} disabled={!passphrase} onClick={handleReveal}>
            {t('onboarding', 'tapToReveal')}
          </Button>
        </Stack>
      ) : (
        <Stack gap={3}>
          <Banner tone="danger">{t('onboarding', 'revealWarning')}</Banner>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 'var(--space-2)',
              fontFamily: 'var(--font-mono)',
              background: 'var(--color-bg)',
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            {mnemonic.split(' ').map((word, i) => (
              <div key={i} style={{ display: 'flex', gap: 6 }}>
                <span style={{ color: 'var(--color-text-faint)', width: 20 }}>{i + 1}.</span>
                <span style={{ fontWeight: 600 }}>{word}</span>
              </div>
            ))}
          </div>
          <Button variant="secondary" onClick={onClose}>
            {t('common', 'done')}
          </Button>
        </Stack>
      )}
    </Sheet>
  );
}
