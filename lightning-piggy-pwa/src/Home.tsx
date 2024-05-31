// Home.tsx
import React, { useState, useEffect, FC } from 'react';
import { Container, Box, Typography, Button, SvgIcon } from '@mui/material';
import BottomSheet from './components/BottomSheet';
import TransactionList from './components/TransactionList';
import lnbitsService from './api/lnbitsService';
import { HomeContainer, HomeBalance, HomeHello, HomeAllowance } from './styles/Home';
import Header from './components/Header';
import FooterNavigation from './components/FooterNavigation';
import ReceiveSheet from './components/ReceiveSheet';
import piggyImage from './images/lightning-piggy-intro.png';

const Home: FC = () => {
    const [balance, setBalance] = useState(null);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [transactions, setTransactions] = useState([]);
    const [receiveSheetOpen, setReceiveSheetOpen] = useState(false);

  const handleOpenSheet = () => {
    setSheetOpen(true);
  };

  const handleCloseSheet = () => {
    setSheetOpen(false);
  };

  const handleOpenReceiveSheet = () => {
    setReceiveSheetOpen(true);
  };

  const handleCloseReceiveSheet = () => {
    setReceiveSheetOpen(false);
  };

  useEffect(() => {
    const fetchBalance = async () => {
      const balance = await lnbitsService.getBalance();
      setBalance(balance);
    };

    const fetchTransactions = async () => {
        const transactions = await lnbitsService.getPayments();
        setTransactions(transactions);
      };

    fetchBalance();
    fetchTransactions();
  }, []);

  return (
<Container style={{ 
    background: `var(--brand-pink, #EC008C)`, 
    width: '430px', 
    height: '430px', 
    flexShrink: 0, 
    position: 'fixed', 
    margin: 0, 
    padding: 0 
}}>
        <Header />
        <Box style={{ 
    background: `linear-gradient(rgba(236, 0, 140, 0.8), rgba(236, 0, 140, 0.8)), url(${piggyImage})`, 
          //background: `url(${piggyImage}) lightgray 50% / cover no-repeat`,
    backgroundPosition: '150% 50%',
    backgroundRepeat: 'no-repeat',
    width: '430px', 
    height: '430px', 
    flexShrink: 0, 
    position: 'fixed', 
    margin: 0, 
    left: '30%',
    top: '10px',
    padding: 0,
    zIndex: -1,
}}>
    {/* Your content here */}
</Box>
        <Box sx={{
          display: 'flex',
          width: '430px',
          height: '374px',
          padding: '70px 20px 40px 20px',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '40px',
          flexShrink: '0',
        }}>
            
            <HomeHello sx={{
              color: 'var(--text-text-inverted, #FFF)',
              /* Headers/H2 slim */
              fontFamily: 'Segoe UI',
              fontSize: '28px',
              fontStyle: 'normal',
              fontWeight: '400',
              lineHeight: 'normal',
              letterSpacing: '0.11px', 
            }}>Hello, Nineveh!</HomeHello>
            <HomeBalance>{balance ? `${balance} Sats` : 'Loading...'}</HomeBalance>
            <HomeAllowance>Next <u>allowance</u> in 3 days <b>80,000 Sats</b></HomeAllowance>
            <Box sx={{
              display: 'flex',
              width: '357px',
              paddingLeft: '15px',
              alignItems: 'flex-start',
              gap: '20px',
            }}>
              <Button variant="contained" color="primary" onClick={handleOpenReceiveSheet}
                  sx={{
                    display: 'flex',
                    height: '52px',
                    padding: '10px 20px',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: '10px',
                    flex: '1 0 0',
                    borderRadius: '12px',
                    background: 'var(--buttons-button-active, #FFF)',
                    boxShadow: '0px 0px 12px 0px rgba(0, 0, 0, 0.15)',
                    textTransform: 'lowercase',
                  }}
              >
                <SvgIcon>
                  <path d="M8.75001 2C9.16422 2 9.50001 2.33579 9.50001 2.75V11.537L12.4411 8.24991C12.7173 7.94122 13.1914 7.91488 13.5001 8.19107C13.8088 8.46727 13.8351 8.94141 13.5589 9.2501L9.30894 14.0001C9.16666 14.1591 8.96339 14.25 8.75001 14.25C8.53663 14.25 8.33336 14.1591 8.19108 14.0001L3.94108 9.2501C3.66488 8.94141 3.69122 8.46727 3.99991 8.19107C4.3086 7.91488 4.78274 7.94122 5.05894 8.24991L8.00001 11.537V2.75C8.00001 2.33579 8.3358 2 8.75001 2Z" fill="#EC008C"/>
                </SvgIcon>
                <Typography
                  sx={{
                    color: 'var(--text-text-inverted, #EC008C)',
                    fontFamily: '"Segoe UI"',
                    fontSize: '16px',
                    fontStyle: 'normal',
                    fontWeight: '700',
                  }}
                >
                  Receive
                </Typography>
              </Button>
              <Button variant="contained" color="primary"
                  sx={{
                    display: 'flex',
                    height: '52px',
                    padding: '10px 20px',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: '10px',
                    flex: '1 0 0',
                    borderRadius: '12px',
                    background: 'var(--buttons-button-active, #FFF)',
                    boxShadow: '0px 0px 12px 0px rgba(0, 0, 0, 0.15)',
                    textTransform: 'lowercase',
                  }}
              >
                <Typography
                  sx={{
                    color: 'var(--text-text-inverted, #EC008C)',
                    fontFamily: '"Segoe UI"',
                    fontSize: '16px',
                    fontStyle: 'normal',
                    fontWeight: '700',
                  }}
                >
                  Send
                </Typography>
                <SvgIcon>
                  <path d="M8.75001 14C8.33579 14 8.00001 13.6642 8.00001 13.25V4.46302L5.05894 7.75009C4.78274 8.05878 4.3086 8.08512 3.99991 7.80893C3.69122 7.53273 3.66488 7.05859 3.94108 6.7499L8.19107 1.9999C8.33335 1.84089 8.53663 1.75 8.75 1.75C8.96338 1.75 9.16666 1.84089 9.30894 1.9999L13.5589 6.7499C13.8351 7.05859 13.8088 7.53273 13.5001 7.80893C13.1914 8.08512 12.7173 8.05878 12.4411 7.75009L9.50001 4.46302V13.25C9.50001 13.6642 9.16422 14 8.75001 14Z" fill="#EC008C"/>
                </SvgIcon>
              </Button>
            </Box>
        </Box>

        <ReceiveSheet open={receiveSheetOpen} onClose={handleCloseReceiveSheet} />
        <BottomSheet open={sheetOpen} onClose={handleCloseSheet}>
            {transactions?.map((transaction, index) => (
            <TransactionList key={index} transaction={transaction} />
            ))}
        </BottomSheet>
        <FooterNavigation />
    </Container>
  );
}

export default Home;