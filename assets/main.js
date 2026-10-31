import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
createRoot(document.getElementById('root')).render(_jsx(React.StrictMode, { children: _jsx(App, {}) }));
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        const base = window.APC_CONFIG?.BASE_URL || '/APC/';
        navigator.serviceWorker.register(`${base}sw.js`).catch(() => undefined);
    });
}
