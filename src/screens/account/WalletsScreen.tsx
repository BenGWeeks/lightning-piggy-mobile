import React, { useState } from 'react';
import { Plus, Wallet } from 'lucide-react-native';
import ManagedWalletRow from '../../components/ManagedWalletRow';
import AccountScreenLayout from './AccountScreenLayout';
import SettingsRow from '../../components/SettingsRow';
import SettingsSection from '../../components/SettingsSection';
import WalletSettingsSheet from '../../components/WalletSettingsSheet';
import AddWalletWizard from '../../components/AddWalletWizard';
import DefaultOnchainWalletSection from '../../components/DefaultOnchainWalletSection';
import { useWallet } from '../../contexts/WalletContext';
import { useLocale } from '../../contexts/LocaleContext';

const WalletsScreen: React.FC = () => {
  const { t } = useLocale();
  const { wallets, removeWallet, updateWalletSettings, reorderWallet } = useWallet();
  const [settingsWalletId, setSettingsWalletId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const connectedCount = wallets.filter((w) =>
    w.walletType === 'onchain' ? w.balance !== null : w.isConnected,
  ).length;

  return (
    <AccountScreenLayout title={t('walletsScreen.title')}>
      <SettingsSection scope="account" showHeading={false} testID="wallets-section">
        <SettingsRow
          icon={Wallet}
          title={t('walletsScreen.title')}
          value={
            wallets.length === 0
              ? t('walletsScreen.noWallets')
              : t('walletsScreen.walletCount', { count: wallets.length, connected: connectedCount })
          }
          testID="wallets-summary-row"
        />
        {wallets.map((wallet, index) => (
          <ManagedWalletRow
            key={wallet.id}
            wallet={wallet}
            index={index}
            walletCount={wallets.length}
            onOpenSettings={setSettingsWalletId}
            onRemove={removeWallet}
            onReorder={reorderWallet}
            onUpdateSettings={updateWalletSettings}
          />
        ))}
        <SettingsRow
          icon={Plus}
          title={t('walletsScreen.addWallet')}
          onPress={() => setWizardOpen(true)}
          accessibilityLabel={t('walletsScreen.addWalletA11y')}
          testID="add-wallet-button"
        />
        <DefaultOnchainWalletSection />
      </SettingsSection>
      <WalletSettingsSheet walletId={settingsWalletId} onClose={() => setSettingsWalletId(null)} />
      <AddWalletWizard visible={wizardOpen} onClose={() => setWizardOpen(false)} />
    </AccountScreenLayout>
  );
};

export default WalletsScreen;
