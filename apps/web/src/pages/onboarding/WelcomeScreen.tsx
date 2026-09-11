import { useI18n } from '../../i18n/index.js';
import { Button } from '../../design-system/Button.js';
import { Stack } from '../../design-system/Stack.js';
import { Card } from '../../design-system/Card.js';

export function WelcomeScreen({ onCreate, onRestore }: { onCreate: () => void; onRestore: () => void }) {
  const { t } = useI18n();
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }}>
      <div style={{ width: '100%', maxWidth: 'var(--content-max-width)' }}>
        <Stack gap={6} align="stretch">
          <Stack gap={3}>
            <div style={{ fontSize: 40 }}>🔐</div>
            <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 800 }}>{t('onboarding', 'welcomeTitle')}</h1>
            <p style={{ color: 'var(--color-text-muted)' }}>{t('onboarding', 'welcomeBody')}</p>
          </Stack>
          <Card padSm>
            <Stack gap={3}>
              <Button onClick={onCreate}>{t('onboarding', 'createNew')}</Button>
              <Button variant="ghost" onClick={onRestore}>
                {t('onboarding', 'restoreExisting')}
              </Button>
            </Stack>
          </Card>
        </Stack>
      </div>
    </div>
  );
}
