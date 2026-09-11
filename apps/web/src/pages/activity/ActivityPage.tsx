import { useEffect, useState } from 'react';
import * as api from '../../apiClient.js';
import { useI18n } from '../../i18n/index.js';
import { Screen } from '../../design-system/Screen.js';
import { Card } from '../../design-system/Card.js';
import { Stack } from '../../design-system/Stack.js';
import { Spinner, EmptyState } from '../../design-system/Feedback.js';
import { ActivityRow } from './ActivityRow.js';

export function ActivityPage({ refreshKey }: { refreshKey: number }) {
  const { t } = useI18n();
  const [history, setHistory] = useState<api.TransactionViewRow[] | null>(null);

  useEffect(() => {
    api.getHistory().then(setHistory);
  }, [refreshKey]);

  return (
    <Screen title={t('activity', 'title')}>
      {history === null ? (
        <Spinner />
      ) : history.length === 0 ? (
        <Card>
          <EmptyState icon="📜" title={t('activity', 'empty')} />
        </Card>
      ) : (
        <Card padSm>
          <Stack gap={0}>
            {history.map((row, i) => (
              <ActivityRow key={row.id} row={row} divider={i > 0} />
            ))}
          </Stack>
        </Card>
      )}
    </Screen>
  );
}
