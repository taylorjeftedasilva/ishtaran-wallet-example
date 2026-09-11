import { useEffect, useState } from 'react';
import * as api from '../../apiClient.js';
import { useI18n } from '../../i18n/index.js';
import { useSession } from '../../state/SessionContext.js';
import { getReceivingAddress } from '../../wallet/localWallet.js';
import { Screen } from '../../design-system/Screen.js';
import { Card } from '../../design-system/Card.js';
import { Stack, Row } from '../../design-system/Stack.js';
import { Button } from '../../design-system/Button.js';
import { TextField } from '../../design-system/TextField.js';
import { Badge, Spinner } from '../../design-system/Feedback.js';
import { QrCode } from '../../design-system/QrCode.js';
import { CopyableField } from './CopyableField.js';
import { PaymentRequestDetailSheet } from './PaymentRequestDetailSheet.js';

const STATUS_TONE: Record<api.PaymentRequestStatus, 'success' | 'danger' | 'warning' | 'info' | 'neutral'> = {
  PAID: 'success',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
  ACTIVE: 'info',
  DRAFT: 'neutral',
};

/**
 * Two distinct receiving mechanisms, never conflated: (A) "Receber transferência" -- this
 * wallet's own address, for a direct wallet-to-wallet transfer (mirrors Enviar/SendTab.tsx,
 * never touches Ishtaran). (B) "Criar cobrança" -- a real Payment Request, which drives the
 * unchanged Transaction/PaymentIntent/Settlement pipeline with a real derived deposit address
 * once someone pays it (paid via Pagar/PayTab.tsx).
 */
export function ReceivePage({ onDataChanged }: { onDataChanged: () => void }) {
  const { t, locale } = useI18n();
  const { appConfig } = useSession();
  const [address, setAddress] = useState<string | null>(null);
  const [requests, setRequests] = useState<api.PaymentRequestRow[] | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [justCreated, setJustCreated] = useState<api.PaymentRequestRow | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<api.PaymentRequestRow | null>(null);

  function refresh() {
    api.listPaymentRequests().then(setRequests);
  }

  useEffect(() => {
    getReceivingAddress().then((a) => setAddress(a ?? null));
    refresh();
  }, []);

  async function handleCreateRequest() {
    setBusy(true);
    try {
      const created = await api.createPaymentRequest(amount, description);
      setJustCreated(created);
      setAmount('');
      setDescription('');
      refresh();
      onDataChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={t('receive', 'title')}>
      <Card>
        <Stack gap={3}>
          <span style={{ fontSize: 'var(--font-size-md)', fontWeight: 700 }}>↙️ {t('receive', 'receiveTransferTitle')}</span>
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{t('receive', 'receiveTransferBody')}</p>
          {address !== null ? <CopyableField value={address} /> : <Spinner />}
        </Stack>
      </Card>

      {appConfig.paymentRequestEnabled && (
        <Card>
          <Stack gap={3}>
            <Stack gap={1}>
              <span style={{ fontSize: 'var(--font-size-md)', fontWeight: 700 }}>🧾 {t('receive', 'requestTitle')}</span>
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{t('receive', 'requestBody')}</p>
            </Stack>
            {justCreated && (
              <Card padSm>
                <Stack gap={3}>
                  <Stack gap={2}>
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{t('receive', 'shareRequestId')}</span>
                    <CopyableField value={justCreated.id} />
                  </Stack>
                  <Stack gap={2} align="center">
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{t('receive', 'scanToPay')}</span>
                    <QrCode value={justCreated.id} size={180} />
                  </Stack>
                </Stack>
              </Card>
            )}
            <TextField label={t('receive', 'amountLabel')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <TextField
              label={`${t('receive', 'descriptionLabel')} (${t('common', 'optional')})`}
              placeholder={t('receive', 'descriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <Button busy={busy} disabled={!amount || Number(amount) <= 0} onClick={handleCreateRequest}>
              {t('receive', 'createRequest')}
            </Button>
          </Stack>
        </Card>
      )}

      {appConfig.paymentRequestEnabled && (
        <Stack gap={3}>
          <h2 style={{ fontSize: 'var(--font-size-md)', fontWeight: 700 }}>{t('receive', 'yourRequests')}</h2>
          {requests === null ? (
            <Spinner />
          ) : requests.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>{t('receive', 'noRequests')}</p>
          ) : (
            <Card padSm>
              <Stack gap={0}>
                {requests.map((r, i) => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRequest(r)}
                    style={{
                      background: 'none',
                      border: 'none',
                      textAlign: 'left',
                      width: '100%',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    <Row
                      justify="space-between"
                      style={{ padding: 'var(--space-3) 0', borderTop: i > 0 ? '1px solid var(--color-border)' : undefined }}
                    >
                      <Stack gap={0}>
                        <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>{r.description || t('receive', 'noDescriptionFallback')}</span>
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)' }}>{r.amount} USDT</span>
                      </Stack>
                      <Row gap={2}>
                        <Badge tone={STATUS_TONE[r.status]}>
                          {r.status === 'ACTIVE' ? t('receive', 'awaitingPayment') : t('receive', `requestStatus_${r.status}`)}
                        </Badge>
                        <span style={{ color: 'var(--color-text-faint)' }}>›</span>
                      </Row>
                    </Row>
                  </button>
                ))}
              </Stack>
            </Card>
          )}
        </Stack>
      )}

      {selectedRequest && (
        <PaymentRequestDetailSheet
          request={selectedRequest}
          locale={locale}
          onClose={() => setSelectedRequest(null)}
          onChanged={() => {
            refresh();
            onDataChanged();
          }}
        />
      )}
    </Screen>
  );
}
