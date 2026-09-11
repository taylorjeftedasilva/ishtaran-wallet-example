import { useState } from 'react';
import { useI18n } from '../../i18n/index.js';
import { Button } from '../../design-system/Button.js';
import { Row } from '../../design-system/Stack.js';

export function CopyableField({ value }: { value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable (older browser, denied permission) -- the value is
      // already selectable text, so this is a soft failure, never a blocker.
    }
  }

  return (
    <Row
      gap={2}
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--space-3)',
      }}
    >
      <code style={{ flex: 1, fontSize: 'var(--font-size-sm)', wordBreak: 'break-all' }}>{value}</code>
      <Button compact variant={copied ? 'secondary' : 'ghost'} onClick={handleCopy}>
        {copied ? `✓ ${t('common', 'copied')}` : t('common', 'copy')}
      </Button>
    </Row>
  );
}
