import React, { useState } from 'react';

type WalletContextType = {
  walletId: string | null;
  walletAdminKey: string | null;
  walletInKey: string | null;
  walletBalance: number | null;
  setWallet: (
    id: string,
    adminKey: string,
    inKey: string,
    balance: number,
  ) => void;
  setWalletBalance: (balance: number) => void;
};

export const WalletContext = React.createContext<WalletContextType | undefined>(
  undefined,
);

export const WalletProvider: React.FC = ({
  children,
}: {
  children?: React.ReactNode;
}) => {
  const [walletId, setWalletId] = useState<string | null>(null);
  const [walletAdminKey, setWalletAdminKey] = useState<string | null>(null);
  const [walletInKey, setWalletInKey] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);

  const setWallet = (
    id: string,
    adminKey: string,
    inKey: string,
    balance: number,
  ) => {
    console.log('setWallet function is being called');
    console.log(
      `Setting wallet with id: ${id}, adminKey: ${adminKey}, inKey: ${inKey}, balance: ${balance}`,
    );
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
