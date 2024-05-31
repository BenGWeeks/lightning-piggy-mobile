// src/components/FooterNavigation.tsx
import React from 'react';
import { BottomNavigation, BottomNavigationAction } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import HomeIcon from '../images/Home.png';
import EarnIcon from '../images/Earn.png';
import LearnIcon from '../images/Learn.png';
import AccountIcon from '../images/Account.png';

const FooterNavigation: React.FC = () => {
  const navigate = useNavigate();
  const [value, setValue] = React.useState('home');

  const handleChange = (event: React.ChangeEvent<{}>, newValue: string) => {
    setValue(newValue);
    navigate(`/${newValue}`);
  };

  return (
    <BottomNavigation value={value} onChange={handleChange} showLabels style={{ width: '100%', display: 'flex', bottom: 0, left: 0, position: 'fixed', alignItems: 'centre', gap: '20px', padding: '10px 0px 30px 10px' }}>
      <BottomNavigationAction label="Home" value="home" icon={<img src={HomeIcon} alt="Home" />} style={{ display: 'flex', padding: '10px', flexDirection: 'column', alignItems: 'center', flex: '1 0 0', fontFamily: 'Segoe UI', fontSize: '16px', fontWeight: 700 }} />
      <BottomNavigationAction label="Earn" value="earn" icon={<img src={EarnIcon} alt="Earn" />} style={{ display: 'flex', padding: '10px', flexDirection: 'column', alignItems: 'center', flex: '1 0 0', fontFamily: 'Segoe UI', fontSize: '16px', fontWeight: 700 }} />
      <BottomNavigationAction label="Learn" value="learn" icon={<img src={LearnIcon} alt="Learn" />} style={{ display: 'flex', padding: '10px', flexDirection: 'column', alignItems: 'center', flex: '1 0 0', fontFamily: 'Segoe UI', fontSize: '16px', fontWeight: 700 }} />
      <BottomNavigationAction label="Account" value="account" icon={<img src={AccountIcon} alt="Account" />} style={{ display: 'flex', padding: '10px', flexDirection: 'column', alignItems: 'center', flex: '1 0 0', fontFamily: 'Segoe UI', fontSize: '16px', fontWeight: 700, paddingRight: '12px !important' }} />
    </BottomNavigation>
  );
};

export default FooterNavigation;