import React from 'react';
import { createRoot } from 'react-dom/client';
import IncompleteRepository from './IncompleteRepository.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <IncompleteRepository />
  </React.StrictMode>
);
