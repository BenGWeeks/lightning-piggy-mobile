// App.tsx
import React, { useState } from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { styled } from '@mui/system';
import IntroScreen from './IntroScreen';
import Home from './Home';
import Earn from './Earn';
import Learn from './Learn';
import Account from './Account';

const AppContainer = styled('div')({
  background: 'var(--brand-pink, #EC008C)',
  minHeight: '100vh',
});

const App: React.FC = () => {
  return (
    <AppContainer>
    <Router>
      <Routes>
        <Route path="/" element={<IntroScreen />} />
        <Route path="/home" element={<Home />} />
        <Route path="/earn" element={<Earn />} />
        <Route path="/learn" element={<Learn />} />
        <Route path="/account" element={<Account />} />
      </Routes>
    </Router>
    </AppContainer>
  );
}

export default App;