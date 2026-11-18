import React from 'react';
import { createPortal } from 'react-dom';

/** Модалки рендерим в body: предок с backdrop-filter/transform иначе станет «рамкой» для position: fixed. */
export const Portal: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  typeof document === 'undefined' ? <>{children}</> : createPortal(children, document.body);
