import React, { useState } from 'react';
import { WalletContext } from '../contexts/WalletContext';

export const WalletProvider: React.FC<React.PropsWithChildren<{}>> = ({
  children,
}) => {
  const [walletId, setWalletId] = useState<string | null>(null);
  const [walletInKey, setWalletInKey] = useState<string | null>(null);
  const [walletAdminKey, setWalletAdminKey] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);

  const setWallet = (
    id: string,
    adminKey: string,
    inKey: string,
    balance: number,
  ) => {
    setWalletId(id);
    setWalletAdminKey(adminKey);
    setWalletInKey(inKey);
    setWalletBalance(balance);
  };

  return (
    <WalletContext.Provider
      value={{
        walletId,
        walletAdminKey,
        walletInKey,
        walletBalance,
        setWallet,
        setWalletBalance,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};
