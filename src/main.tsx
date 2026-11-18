import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { IS_DEMO } from './api';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {IS_DEMO ? <HashRouter><App /></HashRouter> : <BrowserRouter><App /></BrowserRouter>}
  </StrictMode>,
);
