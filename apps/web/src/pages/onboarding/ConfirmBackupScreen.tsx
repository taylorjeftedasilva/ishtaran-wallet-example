import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n/index.js';
import { Button } from '../../design-system/Button.js';
import { Stack } from '../../design-system/Stack.js';
import { TextField } from '../../design-system/TextField.js';
import { Screen } from '../../design-system/Screen.js';

export function ConfirmBackupScreen({ mnemonic, onBack, onConfirmed }: { mnemonic: string; onBack: () => void; onConfirmed: () => void }) {
  const { t } = useI18n();
  const words = useMemo(() => mnemonic.split(' '), [mnemonic]);
  // A fixed-but-non-trivial position (not the first word) -- deterministic per session, real
  // verification that the user actually has their OWN written copy, not a UI simulation.
  const position = useMemo(() => Math.min(Math.max(3, Math.floor(words.length / 2)), words.length), [words.length]);
  const [input, setInput] = useState('');
  const [wrong, setWrong] = useState(false);

  function handleSubmit() {
    if (input.trim().toLowerCase() === words[position - 1]?.toLowerCase()) {
      onConfirmed();
    } else {
      setWrong(true);
    }
  }

  return (
    <Screen onBack={onBack}>
      <Stack gap={5}>
        <Stack gap={2}>
          <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 800 }}>{t('onboarding', 'confirmBackupTitle')}</h2>
          <p style={{ color: 'var(--color-text-muted)' }}>{t('onboarding', 'confirmBackupBody', { position })}</p>
        </Stack>
        <TextField
          label={t('onboarding', 'confirmBackupPlaceholder', { position })}
          autoFocus
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setWrong(false);
          }}
          error={wrong ? t('onboarding', 'confirmBackupWrong') : undefined}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        />
        <Button disabled={input.trim().length === 0} onClick={handleSubmit}>
          {t('onboarding', 'confirmBackupSubmit')}
        </Button>
      </Stack>
    </Screen>
  );
}
