import { useState } from 'react';
import * as api from '../../apiClient.js';
import { createWallet, importWallet } from '../../wallet/localWallet.js';
import { WelcomeScreen } from './WelcomeScreen.js';
import { CreatePasswordScreen } from './CreatePasswordScreen.js';
import { RevealPhraseScreen } from './RevealPhraseScreen.js';
import { ConfirmBackupScreen } from './ConfirmBackupScreen.js';
import { RestorePhraseScreen } from './RestorePhraseScreen.js';
import { SignUpScreen } from './SignUpScreen.js';

type Step = 'welcome' | 'create-password' | 'reveal-phrase' | 'confirm-backup' | 'restore-phrase' | 'signup';

/**
 * Covers "no local wallet yet" only -- see LoginScreen (rendered by App.tsx) for "wallet exists on
 * this device, needs its app-level session back". Two real paths, both real SDK primitives, never
 * a bespoke derivation (localWallet.ts): Create (new mnemonic, generated client-side) or Restore
 * (an existing mnemonic the user already has, e.g. a new device) -- restoring re-derives the SAME
 * receiving address, so it still ends at Sign Up only the first time; a restore of an address that
 * already has an app account is handled by the ordinary Login screen from then on.
 */
export function OnboardingFlow({ onAuthenticated }: { onAuthenticated: (session: api.SessionResult) => void }) {
  const [step, setStep] = useState<Step>('welcome');
  const [mnemonic, setMnemonic] = useState('');
  const [address, setAddress] = useState('');

  async function handleCreatePassword(passphrase: string) {
    const result = await createWallet(passphrase);
    setMnemonic(result.mnemonic);
    setAddress(result.address);
    setStep('reveal-phrase');
  }

  async function handleRestore(restoreMnemonic: string, passphrase: string) {
    const result = await importWallet(restoreMnemonic, passphrase);
    setAddress(result.address);
    setStep('signup');
  }

  async function handleSignUp(email: string, password: string) {
    const result = await api.signup(email, password, address);
    api.setSessionToken(result.sessionToken);
    onAuthenticated(result);
  }

  switch (step) {
    case 'welcome':
      return <WelcomeScreen onCreate={() => setStep('create-password')} onRestore={() => setStep('restore-phrase')} />;
    case 'create-password':
      return <CreatePasswordScreen onBack={() => setStep('welcome')} onSubmit={handleCreatePassword} />;
    case 'reveal-phrase':
      return <RevealPhraseScreen mnemonic={mnemonic} onContinue={() => setStep('confirm-backup')} />;
    case 'confirm-backup':
      return <ConfirmBackupScreen mnemonic={mnemonic} onBack={() => setStep('reveal-phrase')} onConfirmed={() => setStep('signup')} />;
    case 'restore-phrase':
      return <RestorePhraseScreen onBack={() => setStep('welcome')} onSubmit={handleRestore} />;
    case 'signup':
      return <SignUpScreen address={address} onSubmit={handleSignUp} />;
  }
}
