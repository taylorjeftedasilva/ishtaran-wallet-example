import { useState } from 'react';
import * as api from '../../apiClient.js';
import { useI18n } from '../../i18n/index.js';
import { useSession } from '../../state/SessionContext.js';
import { Card } from '../../design-system/Card.js';
import { Stack, Row } from '../../design-system/Stack.js';
import { Button } from '../../design-system/Button.js';
import { TextField } from '../../design-system/TextField.js';
import { Banner, Badge } from '../../design-system/Feedback.js';
import { shorten } from '../../lib/format.js';
import { QrScannerSheet } from './QrScannerSheet.js';

type Step =
  | { name: 'lookup' }
  | { name: 'review'; request: api.PaymentRequestRow; calculation: api.PaymentCalculation }
  | { name: 'success'; request: api.PaymentRequestRow; result: api.FinalizeResult };

type SendPhase = 'idle' | 'broadcasting' | 'settling';

/**
 * "Pagar" -- there is a cobrança (Payment Request) created by someone else, and this wallet pays
 * it using the REAL, unchanged Transaction -> PaymentIntent -> funding -> Settlement pipeline
 * (routes/payments.ts / routes/paymentRequests.ts). Distinct from Enviar (SendTab.tsx), which is
 * a direct wallet-to-wallet transfer with no PaymentIntent/Settlement involved at all.
 */
export function PayTab({ onCompleted, onGoToSandboxTools }: { onCompleted: () => void; onGoToSandboxTools: () => void }) {
  const { t } = useI18n();
  const { appConfig } = useSession();
  const [step, setStep] = useState<Step>({ name: 'lookup' });
  const [requestId, setRequestId] = useState('');
  const [request, setRequest] = useState<api.PaymentRequestRow | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [phase, setPhase] = useState<SendPhase>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insufficientFunds, setInsufficientFunds] = useState<{ available: string; required: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [showFeeDetails, setShowFeeDetails] = useState(false);

  async function lookupById(id: string) {
    setLookupError(null);
    setRequest(null);
    setBusy(true);
    try {
      const found = await api.getPaymentRequest(id.trim());
      if (found.status !== 'ACTIVE') {
        setLookupError(t('send', 'requestAlreadyHandled', { status: t('receive', `requestStatus_${found.status}`) }));
        return;
      }
      setRequest(found);
    } catch {
      setLookupError(t('send', 'requestNotFound'));
    } finally {
      setBusy(false);
    }
  }

  function handleLookup() {
    return lookupById(requestId);
  }

  function handleScanned(text: string) {
    setScanning(false);
    setRequestId(text);
    lookupById(text);
  }

  // Product feedback (Prompt 2 manual review): this must NEVER create a real Transaction --
  // `previewPaymentRequestFees` is a pure, deterministic computation, no Ishtaran call, so
  // reaching the review screen never shows up as a pending payment in Activity before the payer
  // has actually confirmed anything.
  async function handleReviewThisRequest() {
    if (!request) return;
    setError(null);
    setInsufficientFunds(null);
    setBusy(true);
    try {
      const { calculation } = await api.previewPaymentRequestFees(request.id);
      setStep({ name: 'review', request, calculation });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // The REAL Transaction/PaymentIntent is created here, only now -- the single moment the payer
  // has actually tapped "Confirmar e pagar", never earlier.
  async function handleConfirm() {
    if (step.name !== 'review') return;
    setError(null);
    setInsufficientFunds(null);
    setPhase('broadcasting');
    try {
      const createResult = await api.payPaymentRequest(step.request.id);
      await api.simulateSandboxSend(createResult.transactionId, createResult.depositAddress, createResult.amount);
      setPhase('settling');
      const result = await api.finalizePayment(createResult.transactionId);
      setStep({ name: 'success', request: step.request, result });
      onCompleted();
    } catch (err) {
      const apiErr = err as api.ApiError;
      if (apiErr.code === 'INSUFFICIENT_FUNDS') {
        setInsufficientFunds({ available: '0', required: step.request.amount });
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      setPhase('idle');
    }
  }

  if (step.name === 'success') {
    return (
      <div style={{ padding: 'var(--space-4) 0' }}>
        <Stack gap={5} align="center">
          <div style={{ fontSize: 48 }}>✅</div>
          <Stack gap={1} align="center">
            <h1 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 800 }}>{t('send', 'paymentSuccessTitle')}</h1>
            <span style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700 }}>{step.request.amount} USDT</span>
          </Stack>
          <Card style={{ width: '100%' }}>
            <Stack gap={3}>
              <Row justify="space-between">
                <span style={{ color: 'var(--color-text-muted)' }}>{t('activity', 'statusLabel')}</span>
                <Badge tone="success">{step.result.settlementStatus}</Badge>
              </Row>
              {step.result.platformFeeAmount !== undefined && (
                <Row justify="space-between">
                  <Badge tone="feePlatform">{t('send', 'finalPlatformFeeRow')}</Badge>
                  <span>{step.result.platformFeeAmount} USDT</span>
                </Row>
              )}
            </Stack>
          </Card>
          <Button
            onClick={() => {
              setStep({ name: 'lookup' });
              setRequestId('');
              setRequest(null);
            }}
            style={{ width: '100%' }}
          >
            {t('send', 'backToHome')}
          </Button>
        </Stack>
      </div>
    );
  }

  if (step.name === 'review') {
    const { calculation } = step;
    const hasAppFee = Number(calculation.appFeeAmount) > 0;
    const busyPhase = phase !== 'idle';
    return (
      <Stack gap={4}>
        {error && <Banner tone="danger">{error}</Banner>}
        {insufficientFunds && (
          <Banner tone="warning">
            <Stack gap={2}>
              <span>{t('send', 'insufficientFunds')}</span>
              <Button compact variant="secondary" onClick={onGoToSandboxTools}>
                {t('send', 'goToSandboxTools')}
              </Button>
            </Stack>
          </Banner>
        )}
        <Card>
          <Stack gap={4}>
            <Badge tone="info">{t('send', 'flowLabelPayingRequest')}</Badge>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', margin: 0 }}>{t('send', 'reviewNothingSentYetHint')}</p>
            <Row justify="space-between">
              <span style={{ color: 'var(--color-text-muted)' }}>{t('send', 'requestFrom')}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)' }}>{shorten(step.request.requester_account_id)}</span>
            </Row>
            <Row justify="space-between">
              <span style={{ color: 'var(--color-text-muted)' }}>{t('send', 'requestDescription')}</span>
              <span>{step.request.description || t('receive', 'noDescriptionFallback')}</span>
            </Row>
            <div style={{ borderTop: '1px dashed var(--color-border)' }} />
            <Row justify="space-between">
              <span style={{ color: 'var(--color-text-muted)' }}>{t('send', 'amountRow')}</span>
              <span style={{ fontWeight: 700 }}>{step.request.amount} USDT</span>
            </Row>

            <Stack gap={2}>
              <button
                onClick={() => setShowFeeDetails((v) => !v)}
                style={{ background: 'none', border: 'none', textAlign: 'left', display: 'flex', justifyContent: 'space-between', width: '100%', padding: 0 }}
              >
                <span style={{ color: 'var(--color-text-muted)' }}>{t('send', 'feesRow')}</span>
                <Row gap={1}>
                  <span style={{ fontSize: 'var(--font-size-sm)' }}>
                    {hasAppFee ? t('send', 'feesTotalKnown', { amount: calculation.appFeeAmount }) : t('send', 'feesTotalPending')}
                  </span>
                  <span style={{ color: 'var(--color-text-faint)' }}>{showFeeDetails ? '▲' : '▼'}</span>
                </Row>
              </button>
              {showFeeDetails && (
                <Stack gap={2} style={{ marginTop: 'var(--space-1)', paddingLeft: 'var(--space-2)' }}>
                  <Row justify="space-between">
                    <Badge tone="feeApp">{t('send', 'appFeeRow')}</Badge>
                    <span style={{ fontSize: 'var(--font-size-sm)' }}>{hasAppFee ? `${calculation.appFeeAmount} USDT` : t('send', 'appFeeNone')}</span>
                  </Row>
                  <Row justify="space-between">
                    <Badge tone="feePlatform">{t('send', 'platformFeeRow')}</Badge>
                    <span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--font-size-sm)' }}>{t('send', 'platformFeePending')}</span>
                  </Row>
                  <Row justify="space-between">
                    <Badge tone="feeNetwork">{t('send', 'networkCostRow')}</Badge>
                    <span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--font-size-sm)', textAlign: 'right', maxWidth: '55%' }}>
                      {t('send', 'networkCostCoveredByApp', { appName: appConfig.appName })}
                    </span>
                  </Row>
                </Stack>
              )}
            </Stack>

            <div style={{ borderTop: '1px dashed var(--color-border)' }} />
            <Row justify="space-between">
              <span style={{ color: 'var(--color-text-muted)' }}>{t('send', 'recipientGetsRow')}</span>
              <span style={{ fontWeight: 700 }}>{calculation.recipientNet} USDT</span>
            </Row>
            <Row justify="space-between">
              <span style={{ fontWeight: 700 }}>{t('send', 'totalImpactRow')}</span>
              <span style={{ fontWeight: 800, fontSize: 'var(--font-size-lg)' }}>{calculation.senderDebit} USDT</span>
            </Row>
          </Stack>
        </Card>
        <Button busy={busyPhase} onClick={handleConfirm}>
          {phase === 'idle' ? t('send', 'confirmAndSend') : phase === 'broadcasting' ? t('send', 'broadcasting') : t('send', 'settling')}
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap={4}>
      {error && <Banner tone="danger">{error}</Banner>}
      <Card>
        <Stack gap={4}>
          <TextField
            label={t('send', 'requestIdLabel')}
            placeholder={t('send', 'requestIdPlaceholder')}
            value={requestId}
            onChange={(e) => {
              setRequestId(e.target.value);
              setRequest(null);
            }}
            trailing={
              <button
                onClick={() => setScanning(true)}
                aria-label={t('send', 'scanQrTitle')}
                style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', padding: 4 }}
              >
                📷
              </button>
            }
          />
          {lookupError && <Banner tone="danger">{lookupError}</Banner>}
          {!request ? (
            <Button busy={busy} disabled={!requestId.trim()} onClick={handleLookup}>
              {t('send', 'lookUpRequest')}
            </Button>
          ) : (
            <Stack gap={3}>
              <Badge tone="info">{t('send', 'requestSummaryTitle')}</Badge>
              <Stack gap={1}>
                <Row justify="space-between">
                  <span style={{ color: 'var(--color-text-muted)' }}>{t('send', 'requestFrom')}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)' }}>{shorten(request.requester_account_id)}</span>
                </Row>
                <Row justify="space-between">
                  <span style={{ color: 'var(--color-text-muted)' }}>{t('send', 'requestDescription')}</span>
                  <span>{request.description || t('receive', 'noDescriptionFallback')}</span>
                </Row>
                <Row justify="space-between">
                  <span style={{ color: 'var(--color-text-muted)' }}>{t('send', 'amountRow')}</span>
                  <span style={{ fontWeight: 700 }}>{request.amount} USDT</span>
                </Row>
              </Stack>
              <Button busy={busy} onClick={handleReviewThisRequest}>
                {t('send', 'payThisRequest')}
              </Button>
            </Stack>
          )}
        </Stack>
      </Card>
      {scanning && <QrScannerSheet onScanned={handleScanned} onClose={() => setScanning(false)} />}
    </Stack>
  );
}
