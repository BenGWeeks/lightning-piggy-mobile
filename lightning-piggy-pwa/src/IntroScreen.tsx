// IntroScreen.tsx
import React, { FC } from 'react';
import Button from '@mui/material/Button';
import introImage from './images/lightning-piggy-intro.png';
import logo from './images/lightning-piggy-logo.png';
import bitcoinLogo from './images/bitcoin-logo.png';
interface IntroScreenProps {
  onLetsGoClick: () => void;
}

const IntroScreen: FC<IntroScreenProps> = ({ onLetsGoClick }) => {
    return (
        <div style={{ backgroundColor: '#EC008C', height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'center' }}>
            <img src={introImage} alt="Intro" style={{ maxWidth: '100%' }} />
            <img src={logo} alt="Lightning Piggy Logo" style={{ maxWidth: '100%', marginTop: '24px' }} />
            <p style={{ color: 'white', fontFamily: 'Segoe UI', maxWidth: '300px', marginTop: '37px', fontSize: '16px', fontStyle: 'normal', fontWeight: '400', lineHeight: 'normal' }}>
                An electronic cash piggy bank for children that accepts bitcoin sent over lightning, while displaying the amount saved in satoshis
            </p>
            <Button variant="contained" onClick={onLetsGoClick} style={{ backgroundColor: 'white', color: '#EC008C', marginTop: '37px', fontFamily: 'Segoe UI', fontSize: '16px', fontStyle: 'normal', fontWeight: '700', lineHeight: 'normal', borderRadius: '12px', boxShadow: '0px 0px 12px 0px rgba(0, 0, 0, 0.15)', display: 'inline-flex', height: '52px', padding: '10px 20px', justifyContent: 'center', alignItems: 'center', gap: '10px', flexShrink: '0' }}>
                Let's Go
            </Button>
            <img src={bitcoinLogo} alt="Bitcoin Logo" style={{ maxWidth: '100%', marginTop: '37px' }} />
        </div>
    );
}

export default IntroScreen;