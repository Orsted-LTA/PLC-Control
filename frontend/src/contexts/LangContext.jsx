import React, { createContext, useContext, useState, useCallback } from 'react';
import vi from '../locales/vi';
import en from '../locales/en';
import zh from '../locales/zh';

const locales = { vi, en, zh };

const LangContext = createContext(null);

export function LangProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('lang') || 'vi');

  const t = useCallback(
    (key, vars = {}) => {
      const locale = locales[lang] || locales.vi;
      let str = locale[key] || en[key] || key;
      Object.entries(vars).forEach(([k, v]) => {
        str = str.replace(`{${k}}`, v);
      });
      return str;
    },
    [lang]
  );

  const switchLang = useCallback((l) => {
    setLang(l);
    localStorage.setItem('lang', l);
  }, []);

  return (
    <LangContext.Provider value={{ lang, t, switchLang }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
