import React from 'react';
import { Link } from 'react-router-dom';
import logo from '../images/lightning-piggy-pig-logo.png';

function Header() {
  return (
<header style={{ 
    position: 'absolute', 
    top: 10, 
    left: 10, 
    display: 'flex', 
    width: '390px', 
    alignItems: 'flex-start', 
    gap: '10px' 
}}>
<Link to="/" style={{ 
    display: 'flex', 
    flexDirection: 'column', 
    alignItems: 'flex-start', 
    gap: '10px', 
    flex: '1 0 0' 
}}>
        <img src={logo} alt="Logo" />
      </Link>
    </header>
  );
}

export default Header;