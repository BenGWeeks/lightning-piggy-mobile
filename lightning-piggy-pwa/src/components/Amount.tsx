import React from 'react';
import { Box, TextField } from '@mui/material';

interface AmountProps {
  amount: string;
  handleAmountChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const Amount: React.FC<AmountProps> = ({ amount, handleAmountChange }) => (
  <Box
    sx={{
      width: '398px',
      height: '204px',
      borderRadius: '32px',
      border: '1px solid var(--bg-divider, #F5F5F5)',
      background: 'var(--bg-background, red)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '4px',
    }}
  >
    <Box
      sx={{
        color: 'var(--grey-40, #7C8B9A)',
        textAlign: 'center',
        fontFamily: '"Segoe UI"',
        fontSize: '16px',
        fontStyle: 'normal',
        fontWeight: '400',
        lineHeight: 'normal',
        display: 'inline-flex',
        padding: '4px 8px',
        alignItems: 'flex-start',
        gap: '8px',
        borderRadius: '12px',
        background: 'var(--bg-secondary-background, #F5F5F5)',
      }}
    >
      SATS
    </Box>
    <TextField
      label="Enter amount"
      variant="outlined"
      fullWidth
      value={amount}
      onChange={handleAmountChange}
      sx={{
        margin: '10px 0',
        '& .MuiInputBase-input': {
          color: 'var(--text-text-error, #EC008C)',
          fontFamily: '"Segoe UI"',
          fontSize: '48px',
          fontStyle: 'normal',
          fontWeight: '700',
          lineHeight: '43.7px',
          letterSpacing: '0.76px',
        },
        '& .MuiFormLabel-root': {
          color: 'var(--grey-40, #7C8B9A)',
          fontFamily: '"Segoe UI"',
          fontSize: '16px',
          fontStyle: 'normal',
          fontWeight: '400',
        },
      }}
    >
      1000
    </TextField>
    <Box
      sx={{
        width: '382px',
        height: '95px',
        flexShrink: 0,
        borderRadius: '4px 4px 24px 24px',
        background: 'var(--bg-secondary-background, #F5F5F5)',
        color: 'var(--grey-40, #7C8B9A)',
        fontFamily: '"Segoe UI"',
        fontSize: '48px',
        fontStyle: 'normal',
        fontWeight: '700',
        lineHeight: '43.7px',
        letterSpacing: '0.76px',
        display: 'inline-flex',
        padding: '4px 8px',
        alignItems: 'flex-start',
        gap: '8px',
      }}
    >
      $0.29
    </Box>
    <Box
      sx={{
        color: 'var(--grey-40, #7C8B9A)',
        textAlign: 'center',
        fontFamily: '"Segoe UI"',
        fontSize: '16px',
        fontStyle: 'normal',
        fontWeight: '400',
        lineHeight: 'normal',
        display: 'inline-flex',
        padding: '4px 8px',
        alignItems: 'flex-start',
        gap: '8px',
        borderRadius: '12px',
        border: '1px solid var(--bg-divider, #F5F5F5)',
        background: 'var(--bg-background, #FFF)',
      }}
    >
      USD
    </Box>
  </Box>
);

export default Amount;
