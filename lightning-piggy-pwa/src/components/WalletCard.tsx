// WalletCard.tsx
import React, { useContext, useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { WalletContext } from '../contexts/WalletContext';

interface WalletCardProps {
  id?: string;
  name?: string;
  adminkey?: string;
  inkey?: string;
  balance_msat?: number;
}

const WalletCard: React.FC<WalletCardProps> = ({
  id,
  name,
  adminkey,
  inkey,
  balance_msat,
}) => {
  const navigate = useNavigate();

  const walletContext = useContext(WalletContext);
  const [hasClicked, setHasClicked] = useState(false);

  if (!walletContext) {
    throw new Error('WalletContext is undefined');
  }

  const { walletId, walletAdminKey, walletInKey, walletBalance, setWallet } =
    walletContext;

  useEffect(() => {
    console.log(
      `walletId, walletAdminKey, walletInKey: ${walletId}, ${walletAdminKey}, ${walletInKey}`,
    );
    if (walletId && walletAdminKey && walletInKey && hasClicked) {
      console.log('Navigating to /home now that walletContext is set.');
      navigate('/home');
    }
  }, [walletContext, hasClicked]);

  const handleClick = () => {
    console.log('setWallet:', setWallet);
    console.log('id:', id);
    console.log('adminkey:', adminkey);
    console.log('inkey:', inkey);
    console.log('balance_msat:', balance_msat);

    if (setWallet && id && adminkey && inkey && balance_msat) {
      console.log('Setting wallet:', id, adminkey, inkey, balance_msat / 1000);
      console.log('About to set wallet');
      setWallet(id, adminkey, inkey, balance_msat / 1000);
      setHasClicked(true);
      console.log('Finished setting wallet:', id, adminkey, inkey);
      //navigate('/home');
    } else {
      // Handle the error here. For example, you could show an error message to the user.
      console.error('setWallet, id, adminkey or inkey is undefined');
    }
  };

  return (
    <Box
      onClick={handleClick}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '150px', // Adjust the width as needed
        padding: '10px',
        borderRadius: '12px',
        background: 'var(--bg-background, #FFF)',
        boxShadow: '0px 0px 12px 0px rgba(0, 0, 0, 0.15)',
      }}
    >
      <Box
        component="img"
        sx={{
          width: '100px',
          height: '100px',
          borderRadius: '50%',
          background: `url("https://robohash.org/${id}") lightgray 50% / cover no-repeat`,
        }}
      />
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
          marginTop: '10px',
        }}
      >
        <Box
          sx={{
            color: 'var(--text-text-header, #15171A)',
            textAlign: 'center',
            fontFamily: '"Segoe UI"',
            fontSize: '16px',
            fontWeight: '700',
          }}
        >
          {name}
        </Box>
        <Box
          sx={{
            color: 'var(--text-text-supplementary, #7C8B9A)',
            textAlign: 'center',
            fontFamily: '"Segoe UI"',
            fontSize: '16px',
            fontWeight: '400',
          }}
        >
          Child's account
        </Box>
      </Box>
    </Box>
  );
};

export default WalletCard;
