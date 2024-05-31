// Learn.tsx
import React, { useState, useEffect, FC } from 'react';
import { Container, Box, Typography, Button } from '@mui/material';
import BottomSheet from './components/BottomSheet';
import Header from './components/Header';
import FooterNavigation from './components/FooterNavigation';

const Learn: FC = () => {

  return (
    <Container style={{ background: 'var(--brand-pink, #EC008C)', margin: 0, padding: 0 }}>
        <Header />
        <FooterNavigation />
    </Container>
  );
}

export default Learn;