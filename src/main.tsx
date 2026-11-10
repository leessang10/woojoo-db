import { ConfirmProvider } from './components/ConfirmProvider';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './ui.css';
import './fonts.css';
import './styles.css';
import './light-theme.css';
import './workspace-design.css';
import './connection-design.css';
import { applyTheme, readTheme } from './theme';
import { applySettings } from './settings';
// Areas without their own menu would otherwise show the WebView menu (reload, print, inspect).
// Text fields and selected text keep it so copy and paste still work; Shift opens it anywhere in development.
document.addEventListener('contextmenu', event => {
  if (event.defaultPrevented || import.meta.env.DEV && event.shiftKey) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
  if (window.getSelection()?.toString()) return;
  event.preventDefault();
});
applyTheme(readTheme());
applySettings();
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ConfirmProvider><App /></ConfirmProvider></React.StrictMode>);
