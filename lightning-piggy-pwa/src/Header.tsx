import React from 'react';
import { Link } from 'react-router-dom';
import logo from './images/lightning-piggy-pig-logo.png';

function Header() {
  return (
    <header style={{ position: 'absolute', top: 0, left: 0 }}>
      <Link to="/">
        <img src={logo} alt="Logo" />
      </Link>
    </header>
  );
}

export default Header;