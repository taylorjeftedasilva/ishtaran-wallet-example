import { useState } from 'react';
import { useI18n } from '../../i18n/index.js';
import { Button } from '../../design-system/Button.js';
import { Stack } from '../../design-system/Stack.js';
import { Screen } from '../../design-system/Screen.js';
import { Banner } from '../../design-system/Feedback.js';
import { Card } from '../../design-system/Card.js';

export function RevealPhraseScreen({ mnemonic, onContinue }: { mnemonic: string; onContinue: () => void }) {
  const { t } = useI18n();
  const [revealed, setRevealed] = useState(false);
  const words = mnemonic.split(' ');

  return (
    <Screen>
      <Stack gap={5}>
        <Stack gap={2}>
          <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 800 }}>{t('onboarding', 'revealStepTitle')}</h2>
          <p style={{ color: 'var(--color-text-muted)' }}>{t('onboarding', 'revealStepBody')}</p>
        </Stack>
        <Banner tone="danger">{t('onboarding', 'revealWarning')}</Banner>

        {!revealed ? (
          <Card>
            <Button variant="secondary" onClick={() => setRevealed(true)}>
              {t('onboarding', 'tapToReveal')}
            </Button>
          </Card>
        ) : (
          <Card>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 'var(--space-2)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {words.map((word, i) => (
                <div key={i} style={{ display: 'flex', gap: 6 }}>
                  <span style={{ color: 'var(--color-text-faint)', width: 20 }}>{i + 1}.</span>
                  <span style={{ fontWeight: 600 }}>{word}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {revealed && (
          <Stack gap={3}>
            <Button variant="ghost" onClick={() => setRevealed(false)}>
              {t('onboarding', 'hidePhrase')}
            </Button>
            <Button onClick={onContinue}>{t('onboarding', 'iHaveSavedIt')}</Button>
          </Stack>
        )}
      </Stack>
    </Screen>
  );
}
