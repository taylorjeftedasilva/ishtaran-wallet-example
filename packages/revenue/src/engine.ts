// The Revenue Engine -- app-level monetization, deliberately kept outside Ishtaran-core
// (PRODUCT_SPEC.md's 3-fee rule: this is the App Owner Revenue fee, never the Ishtaran Platform
// Fee or the Network Execution Fee -- the three are never conflated). Pure functions only: every
// output here is either dropped directly into a real CreateTransaction call or used to size a
// separate, ordinary side Transaction -- nothing here invents a platform capability.

import type { RevenueEvent, RevenueForm, RevenuePayer, RevenueRule } from '@wallet-app/wallet-core';
import {
  addMicros,
  applyPercentage,
  fromMicros,
  subMicros,
  subtractFromHundred,
  toMicros,
  toSplitPercentage,
} from './decimal.js';

export interface RevenueContext {
  event: RevenueEvent;
  /** The principal amount the flow is nominally about -- what a P2P sender types in, what a
   * merchant charges, or what an account holder asks to withdraw. Not yet adjusted for fees. */
  grossAmount: string;
  rule: RevenueRule;
}

export type RevenueMechanism = 'NONE' | 'SPLIT_PARTICIPANT' | 'SIDE_TRANSACTION';

export interface RevenueAllocation {
  role: 'RECIPIENT' | 'APP_REVENUE';
  splitPercentage: string;
}

export interface RevenueCalculation {
  event: RevenueEvent;
  form: RevenueForm;
  payer: RevenuePayer;
  grossAmount: string;
  /** The amount passed to the real Ishtaran primitive: CreateTransaction.amount for a
   * SPLIT_PARTICIPANT event, RequestWithdrawal.amount for the withdrawal-side SIDE_TRANSACTION. */
  transactionAmount: string;
  /** Total debited from the initiating Account's Available balance, across the primary
   * operation and any side transaction combined. */
  senderDebit: string;
  /** Amount that actually reaches the counterpart: the Transaction recipient, or the external
   * network destination for a withdrawal. */
  recipientNet: string;
  appFeeAmount: string;
  mechanism: RevenueMechanism;
  /** Present only when mechanism === 'SPLIT_PARTICIPANT'; ready to drop into
   * CreateTransaction's ParticipantInput.splitPercentage, ordered [RECIPIENT, APP_REVENUE],
   * summing to exactly "100" (IMPLEMENTATION_PLAN.md Fase A3 -- BR-SPL-003). */
  allocations?: RevenueAllocation[];
}

const SPLIT_PARTICIPANT_EVENTS: ReadonlySet<RevenueEvent> = new Set(['PAYMENT', 'MERCHANT_PAYMENT', 'P2P', 'TRANSFER']);

function computeFeeMicros(grossMicros: bigint, rule: RevenueRule): bigint {
  switch (rule.form) {
    case 'NONE':
      return 0n;
    case 'FIXED':
      if (!rule.value.fixedAmount) throw new Error(`Revenue rule for ${rule.event} is FIXED but has no fixedAmount`);
      return toMicros(rule.value.fixedAmount);
    case 'PERCENTAGE':
      if (!rule.value.percentage) throw new Error(`Revenue rule for ${rule.event} is PERCENTAGE but has no percentage`);
      return applyPercentage(grossMicros, rule.value.percentage);
    case 'FIXED_PLUS_PERCENTAGE': {
      if (!rule.value.fixedAmount || !rule.value.percentage) {
        throw new Error(`Revenue rule for ${rule.event} is FIXED_PLUS_PERCENTAGE but is missing fixedAmount or percentage`);
      }
      return addMicros(toMicros(rule.value.fixedAmount), applyPercentage(grossMicros, rule.value.percentage));
    }
    default: {
      const exhaustive: never = rule.form;
      throw new Error(`Unknown revenue form: ${exhaustive as string}`);
    }
  }
}

/**
 * SENDER and RECEIVER are the only payer semantics implemented -- they cover every real rule in
 * MONETIZED_WALLET_CONFIG. SHARED/APP_OWNER only ever appear paired with form NONE in V1's real
 * config (P2P); a non-zero fee on either is a genuine product gap with no real collection
 * mechanism, so this throws rather than inventing a split for them.
 */
export function calculateRevenue(context: RevenueContext): RevenueCalculation {
  const { event, grossAmount, rule } = context;
  if (rule.event !== event) {
    throw new Error(`Revenue rule is for event ${rule.event}, not ${event}`);
  }

  const grossMicros = toMicros(grossAmount);
  const feeMicros = computeFeeMicros(grossMicros, rule);

  if (feeMicros === 0n) {
    return {
      event,
      form: rule.form,
      payer: rule.payer,
      grossAmount,
      transactionAmount: grossAmount,
      senderDebit: grossAmount,
      recipientNet: grossAmount,
      appFeeAmount: '0',
      mechanism: 'NONE',
    };
  }

  if (rule.payer !== 'SENDER' && rule.payer !== 'RECEIVER') {
    throw new Error(
      `Revenue payer "${rule.payer}" with a non-zero fee is out of scope for V1 -- no real ` +
        'collection mechanism is implemented for it. Register this as a gap instead of guessing.',
    );
  }

  const mechanism: RevenueMechanism = SPLIT_PARTICIPANT_EVENTS.has(event) ? 'SPLIT_PARTICIPANT' : 'SIDE_TRANSACTION';

  if (mechanism === 'SPLIT_PARTICIPANT') {
    const transactionMicros = rule.payer === 'SENDER' ? addMicros(grossMicros, feeMicros) : grossMicros;
    const recipientMicros = rule.payer === 'SENDER' ? grossMicros : subMicros(grossMicros, feeMicros);
    const appPercentage = toSplitPercentage(feeMicros, transactionMicros);
    const recipientPercentage = subtractFromHundred(appPercentage);
    return {
      event,
      form: rule.form,
      payer: rule.payer,
      grossAmount,
      transactionAmount: fromMicros(transactionMicros),
      senderDebit: fromMicros(transactionMicros),
      recipientNet: fromMicros(recipientMicros),
      appFeeAmount: fromMicros(feeMicros),
      mechanism,
      allocations: [
        { role: 'RECIPIENT', splitPercentage: recipientPercentage },
        { role: 'APP_REVENUE', splitPercentage: appPercentage },
      ],
    };
  }

  // SIDE_TRANSACTION (withdrawal): the fee is never part of the real RequestWithdrawal amount --
  // it is realized as a separate, ordinary 1-recipient Transaction to the App Revenue Account
  // (Reserve+Settle, no splitPercentage needed for a single beneficiary -- BR-SPL-004), executed
  // before the real withdrawal is requested.
  const withdrawalMicros = rule.payer === 'SENDER' ? grossMicros : subMicros(grossMicros, feeMicros);
  const senderDebitMicros = rule.payer === 'SENDER' ? addMicros(grossMicros, feeMicros) : grossMicros;
  return {
    event,
    form: rule.form,
    payer: rule.payer,
    grossAmount,
    transactionAmount: fromMicros(withdrawalMicros),
    senderDebit: fromMicros(senderDebitMicros),
    recipientNet: fromMicros(withdrawalMicros),
    appFeeAmount: fromMicros(feeMicros),
    mechanism,
  };
}
