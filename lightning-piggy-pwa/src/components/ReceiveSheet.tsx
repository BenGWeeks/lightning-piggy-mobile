// ReceiveSheet.tsx
import React, { useEffect, useState } from 'react';
import { Box, Button, Drawer, Typography } from '@mui/material';
import { SvgIcon } from '@mui/material';
import QRCode from 'qrcode.react';
import lnbitsService from '../api/lnbitsService'

interface ReceiveSheetProps {
    open: boolean;
    onClose: () => void;
  }

  const ReceiveSheet: React.FC<ReceiveSheetProps> = ({ open, onClose }) => {

    const [invoice, setInvoice] = useState('');

    useEffect(() => {
        if (open) {
            lnbitsService.createInvoice().then(setInvoice);
        }
    }, [open]);
  
    return (
        <Drawer anchor='bottom' open={open} onClose={onClose}>
            <Box
                sx={{
                    borderRadius: '24px 24px 0px 0px',
                    background: 'var(--bg-secondary-background, #F5F5F5)',
                    //display: 'flex',
                    //width: '342px',
                    //alignItems: 'flex-start',
                    display: 'flex',
    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '20px',
                    padding: '20px',
                }}
                >
                <Box
  sx={{
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    alignSelf: 'stretch',
    height: '65px',
    flexDirection: 'column',
    justifyContent: 'center',
    textAlign: 'center',
    flex: '1 0 0',
    color: 'var(--text-text-header, #15171A)',
    fontFamily: 'Segoe UI',
    fontSize: '16px',
    fontStyle: 'normal',
    fontWeight: '700',
    lineHeight: 'normal',
  }}
>
    Receive
</Box>
<Box
  sx={{
    borderRadius: '24px',
    border: '1px solid var(--bg-divider, #F5F5F5)',
    background: 'var(--bg-background, #FFF)',
    display: 'flex',
    height: '220px',
    width: '220px',
    padding: '10px 10px',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  }}
>
  <QRCode
    value={invoice}
    size={210} // Set the size of the QR code to 210x210 pixels
  />
</Box>
        <Box
  sx={{
    width: '351px',
    color: 'var(--text-text-header, #15171A)',
    textAlign: 'center',
    fontFamily: 'Segoe UI',
    fontSize: '16px',
    fontStyle: 'normal',
    fontWeight: '700',
    lineHeight: 'normal',
  }}
>
  Lightning invoice
</Box>
        <Box
            onClick={() => navigator.clipboard.writeText(invoice)}
  sx={{
    width: '351px',
    color: 'var(--text-text-supplementary, #7C8B9A)',
    textAlign: 'center',
    justifyContent: 'center',
    fontFamily: 'Segoe UI',
    fontSize: '16px',
    fontStyle: 'normal',
    fontWeight: '400',
    lineHeight: 'normal',
    wordWrap: 'break-word',
  }}
>{invoice}
</Box>
        <Box
  sx={{
    display: 'flex',
    width: '342px',
    alignItems: 'flex-start',
    justifyContent: 'center', 
    gap: '20px',
  }}
>
        <Button 
            variant="contained" 
            color="primary"
            onClick={() => navigator.clipboard.writeText(invoice)}
            sx={{
                display: 'flex',
                height: '52px',
                padding: '10px 20px',
                justifyContent: 'center',
                gap: '10px',
                //flex: '1 0 0',
                borderRadius: '12px',
                background: 'var(--buttons-button-active, #FFF)',
                boxShadow: '0px 0px 12px 0px rgba(0, 0, 0, 0.15)',
                backgroundColor: 'white',
                width: '120px',
            }}
            >
  <SvgIcon>
    <path d="M6.99854 1C5.89397 1 4.99854 1.89543 4.99854 3V11C4.99854 12.1046 5.89397 13 6.99854 13L12 13C13.1046 13 14 12.1046 14 11V5.5H13.9985V4.41421C13.9985 4.01639 13.8405 3.63486 13.5592 3.35355L11.645 1.43934C11.3637 1.15804 10.9821 1 10.5843 1H6.99854ZM12 12L6.99854 12C6.44625 12 5.99854 11.5523 5.99854 11V3C5.99854 2.44772 6.44625 2 6.99854 2H9.99854V3.5C9.99854 4.32843 10.6701 5 11.4985 5H12.9985V6.06135L13 6.06102V11C13 11.5523 12.5523 12 12 12ZM12.7914 4H11.4985C11.2224 4 10.9985 3.77614 10.9985 3.5V2.20711L12.7914 4ZM3 4C3 3.44772 3.44772 3 4 3V11C4 12.6569 5.34315 14 7 14L12 14C12 14.5523 11.5523 15 11 15H6.78947C4.6966 15 3 13.3034 3 11.2105V4Z" fill="#EC008C"/>
  </SvgIcon>
    <Typography 
        sx={{
            color: '#EC008C',
            fontFamily: '"Segoe UI"',
            fontSize: '16px',
            fontWeight: '700',
            textTransform: 'none',
        }}
    >
        Copy
    </Typography>
    </Button>
    <Button 
            variant="contained" 
            color="primary"
            onClick={async () => {
                if (navigator.share) {
                  try {
                    await navigator.share({
                      title: 'Invoice',
                      text: `lightning:${invoice}`,
                    });
                  } catch (error) {
                    console.error('Something went wrong sharing the invoice', error);
                  }
                } else {
                  console.log('Web Share API is not supported in your browser');
                }
              }}
            sx={{
                display: 'flex',
                height: '52px',
                padding: '10px 20px',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '10px',
                //flex: '1 0 0',
                borderRadius: '12px',
                background: 'var(--buttons-button-active, #FFF)',
                boxShadow: '0px 0px 12px 0px rgba(0, 0, 0, 0.15)',
                backgroundColor: 'white',
            }}
            >

        <Typography 
        sx={{
            color: '#EC008C',
            fontFamily: '"Segoe UI"',
            fontSize: '16px',
            fontWeight: '700',
            textTransform: 'none',
        }}
    >
        Share
    </Typography>
    <SvgIcon>
    <path d="M13.75 7.25C14.1297 7.25 14.4435 7.53215 14.4932 7.89823L14.5 8V13.25C14.5 14.7125 13.3583 15.9084 11.9175 15.995L11.75 16H4.25C2.78747 16 1.5916 14.8583 1.50502 13.4175L1.5 13.25V8C1.5 7.58579 1.83579 7.25 2.25 7.25C2.6297 7.25 2.94349 7.53215 2.99315 7.89823L3 8V13.25C3 13.8972 3.49187 14.4295 4.12219 14.4935L4.25 14.5H11.75C12.3972 14.5 12.9295 14.0081 12.9935 13.3778L13 13.25V8C13 7.58579 13.3358 7.25 13.75 7.25ZM3.22703 4.46231L7.46967 0.21967C7.73594 -0.0465967 8.1526 -0.0708026 8.44621 0.147052L8.53033 0.21967L12.773 4.46231C13.0659 4.7552 13.0659 5.23008 12.773 5.52297C12.5067 5.78924 12.09 5.81344 11.7964 5.59559L11.7123 5.52297L8.75 2.56V10.25C8.75 10.6297 8.46785 10.9435 8.10177 10.9932L8 11C7.6203 11 7.30651 10.7178 7.25685 10.3518L7.25 10.25V2.56L4.28769 5.52297C4.02142 5.78924 3.60476 5.81344 3.31115 5.59559L3.22703 5.52297C2.96076 5.2567 2.93656 4.84004 3.15441 4.54643L3.22703 4.46231L7.46967 0.21967L3.22703 4.46231Z" fill="#EC008C"/>

  </SvgIcon>
        </Button>
        </Box>

        <Box
  sx={{
    width: '366px',
    height: '1px',
    background: '#DDE1E3',
  }}
/>

        <Button variant="contained" color="primary"
            sx={{
                display: 'flex',
                width: '233px',
                height: '52px',
                padding: '10px 20px',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '10px',
                borderRadius: '12px',
                background: 'var(--buttons-button-active, #FFF)',
                boxShadow: '0px 0px 12px 0px rgba(0, 0, 0, 0.15)',
                color: 'var(--text-text-body, #333)',
                fontFamily: 'Segoe UI',
                fontSize: '16px',
                fontStyle: 'normal',
                fontWeight: '700',
                lineHeight: 'normal',
                textTransform: 'none',
              }}
        >
          Enter custom amount
        </Button>
</Box>

      </Drawer>
    );
  };

export default ReceiveSheet;