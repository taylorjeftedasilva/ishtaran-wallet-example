import { useI18n } from '../../i18n/index.js';
import { Sheet } from '../../design-system/Sheet.js';
import { Stack } from '../../design-system/Stack.js';
import { Button } from '../../design-system/Button.js';
import { Banner } from '../../design-system/Feedback.js';

export function ForgetWalletSheet({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet onDismiss={onCancel}>
      <Stack gap={4}>
        <span style={{ fontWeight: 700 }}>{t('settings', 'forgetWallet')}</span>
        <Banner tone="danger">{t('settings', 'forgetWalletWarning')}</Banner>
        <Button variant="danger" onClick={onConfirm}>
          {t('settings', 'forgetWalletConfirm')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('common', 'cancel')}
        </Button>
      </Stack>
    </Sheet>
  );
}
