import { useState } from 'react';
import { useI18n } from '../../i18n/index.js';
import { Screen } from '../../design-system/Screen.js';
import { SegmentedTabs, type MoveMode } from './SegmentedTabs.js';
import { SendTab } from './SendTab.js';
import { PayTab } from './PayTab.js';

/**
 * Enviar and Pagar are one screen with two modes, not two destinations -- the user can toggle
 * between them without leaving. `initialMode` reflects which Home button was pressed, but the
 * segmented control lets them switch freely from here.
 */
export function MoveFlow({
  initialMode,
  onBackToHome,
  onCompleted,
  onGoToSandboxTools,
}: {
  initialMode: MoveMode;
  onBackToHome: () => void;
  onCompleted: () => void;
  onGoToSandboxTools: () => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<MoveMode>(initialMode);

  return (
    <Screen title={mode === 'send' ? t('move', 'sendTab') : t('move', 'payTab')} onBack={onBackToHome}>
      <SegmentedTabs mode={mode} onChange={setMode} />
      {mode === 'send' ? (
        <SendTab onCompleted={onCompleted} onGoToSandboxTools={onGoToSandboxTools} />
      ) : (
        <PayTab onCompleted={onCompleted} onGoToSandboxTools={onGoToSandboxTools} />
      )}
    </Screen>
  );
}
