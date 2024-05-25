// Home.tsx
import React, { useState, FC } from 'react';
import { Container, Box, Typography, Button } from '@mui/material';
import BottomSheet from './components/BottomSheet';
import TransactionList from './components/TransactionList';

const Home: FC = () => {
  const [sheetOpen, setSheetOpen] = useState(false);

  const handleOpenSheet = () => {
    setSheetOpen(true);
  };

  const handleCloseSheet = () => {
    setSheetOpen(false);
  };

  return (
    <Container>
      <Box textAlign="center" mt={5}>
        <Typography variant="h4">Hello, Nineveh!</Typography>
        <Typography variant="h2" color="secondary">47,500 Sats</Typography>
        <Typography variant="body1">Next allowance in 3 days 80,000 Sats</Typography>
        <Box mt={2}>
          <Button variant="contained" color="primary" onClick={handleOpenSheet}>
            Show Transactions
          </Button>
        </Box>
      </Box>
      <BottomSheet open={sheetOpen} onClose={handleCloseSheet}>
        <TransactionList />
      </BottomSheet>
    </Container>
  );
}

export default Home;