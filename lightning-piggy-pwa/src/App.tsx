// App.tsx
import React, { useState } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import IntroScreen from './IntroScreen';
import Home from './Home';
import Header from './Header';

const App: React.FC = () => {
  const [showIntro, setShowIntro] = useState(true);

  const handleLetsGoClick = () => {
    setShowIntro(false);
  };

  return (
    <Router>
      {!showIntro && <Header />} {/* Include Header only when showIntro is false */}
      {showIntro ? 
        <IntroScreen onLetsGoClick={handleLetsGoClick} /> :
        <Home />
      }
    </Router>
  );
}

export default App;