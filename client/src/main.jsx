import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { FleetProvider } from './context/FleetContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <FleetProvider>
          <App />
        </FleetProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
