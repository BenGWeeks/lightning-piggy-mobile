// WalletSelector.tsx
import React, { FC, useState, useEffect, useContext } from 'react';
import { Container, Box, Alert } from '@mui/material';
import Header from './components/Header';
import { WalletProvider } from './components/WalletProvider';
import WalletCard from './components/WalletCard';
import piggyImage from './images/lightning-piggy-intro.png';
import lnbitsService from './api/lnbitsService';
import { WalletContext } from './contexts/WalletContext';

// Define your Wallet type
interface Wallet {
  id: string;
  name: string;
  adminkey: string;
  inkey: string;
  balance_msat: number;
}

const WalletSelector: FC = () => {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    //let isMounted = true; // add this line

    const fetchWallets = async () => {
      try {
        const fetchedWallets = await lnbitsService.getWallets();
        setWallets(fetchedWallets);
      } catch (err: any) {
        console.log('Error:', err.message);
        setError(err.message);
      }
    };

    fetchWallets();

    //return () => {
    //  isMounted = false; // add this line
    //};
  }, []);

  if (error) {
    console.log('Error:', error);
    return <Alert severity="error">{error}</Alert>;
  }

  return (
    <Container
      style={{
        background: `var(--brand-pink, #EC008C)`,
        //width: '100%',
        minHeight: '100vh',
        maxWidth: '100%',
        width: '100vw',
        height: '430px',
        flexShrink: 0,
        position: 'fixed',
        margin: 0,
        padding: 0,
      }}
    >
      <Box>
        <Box
          sx={{
            background: `linear-gradient(rgba(236, 0, 140, 0.8), rgba(236, 0, 140, 0.8)), url(${piggyImage})`,
            backgroundPosition: '150% 50%',
            backgroundRepeat: 'no-repeat',
            width: '430px',
            height: '430px',
            flexShrink: 0,
            //position: 'fixed',
            position: 'relative',
            margin: 0,
            left: '30%',
            top: '10px',
            padding: 0,
            zIndex: -1,
          }}
        ></Box>
        <Header />
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '20px',
            color: 'var(--text-text-inverted, #FFF)',
            textAlign: 'center',
            fontFamily: '"Segoe UI"',
            fontSize: '28px',
            fontStyle: 'normal',
            fontWeight: '700',
            lineHeight: '25.3px',
            letterSpacing: '0.11px',
          }}
        >
          Select wallet
        </Box>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '20px',
            background: 'var(--bg-secondary-background, #F5F5F5)',
            padding: '20px',
            width: '100vw',
          }}
        >
          {wallets.map(wallet => (
            <WalletCard
              key={wallet.id}
              id={wallet.id}
              name={wallet.name}
              adminkey={wallet.adminkey}
              inkey={wallet.inkey}
              balance_msat={wallet.balance_msat}
            />
          ))}
        </Box>
      </Box>
    </Container>
  );
};

export default WalletSelector;
