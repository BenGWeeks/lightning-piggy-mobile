// App.tsx
import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { styled } from '@mui/system';
import IntroScreen from './IntroScreen';
import Home from './Home';
import Earn from './Earn';
import Learn from './Learn';
import Account from './Account';
import { WalletProvider } from './components/WalletProvider';
import WalletSelector from './WalletSelector';

const AppContainer = styled('div')({
  background: 'var(--brand-pink, #EC008C)',
  minHeight: '100vh',
});

const App: React.FC = () => {
  return (
    <AppContainer>
      <WalletProvider>
        <Router>
          <Routes>
            <Route path="/" element={<IntroScreen />} />
            <Route path="/home" element={<Home />} />
            <Route path="/walletSelector" element={<WalletSelector />} />
            <Route path="/earn" element={<Earn />} />
            <Route path="/learn" element={<Learn />} />
            <Route path="/account" element={<Account />} />
          </Routes>
        </Router>
      </WalletProvider>
    </AppContainer>
  );
};

export default App;
