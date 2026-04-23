import { useEffect, useState } from 'react';

const CURRENCY_EVENT = 'pref:currency-changed';

const readPref = () => ({
  code: localStorage.getItem('pref_currencyCode') || 'INR',
  rate: parseFloat(localStorage.getItem('pref_fx_rate')) || null,
});

// Broadcast a currency-pref change in the current tab. formatCrores() already
// reads localStorage on every call, so subscribers just need a re-render
// trigger — no store, no context.
export const emitCurrencyChange = () => {
  window.dispatchEvent(new CustomEvent(CURRENCY_EVENT));
};

// Subscribe the caller to the active currency preference. Updates fire on:
//   - same-tab CustomEvent (dispatched by SettingsPage on change + live-rate refresh)
//   - cross-tab `storage` event (native, fired when another tab sets the key)
// Mount this once high in the tree (Layout) so the whole authenticated tree
// re-renders when the user switches currency.
export default function useCurrencyPref() {
  const [pref, setPref] = useState(readPref);

  useEffect(() => {
    const sync = () => setPref(readPref());
    const onStorage = (e) => {
      if (e.key === 'pref_currencyCode' || e.key === 'pref_fx_rate') sync();
    };
    window.addEventListener(CURRENCY_EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CURRENCY_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return pref;
}
