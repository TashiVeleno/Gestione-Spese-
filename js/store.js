import { uid } from './logic.js';

const KEY = 'gestione-spese-v1';

// Palette categorica validata (ordine fisso) per i colori predefiniti.
export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

export const ACCOUNT_TYPES = {
  cash: { label: 'Contanti', icon: '💶' },
  personal: { label: 'Conto personale', icon: '🏦' },
  shared: { label: 'Conto in comune', icon: '👥' },
  other: { label: 'Altro (carta, buoni…)', icon: '💳' },
};

export function defaultData() {
  const acc = (name, type, color) => ({ id: uid(), name, type, color, archived: false });
  const categories = [];
  const cat = (name, icon, color, subs = []) => {
    const c = { id: uid(), name, icon, color, parentId: null, archived: false };
    categories.push(c);
    for (const s of subs) categories.push({ id: uid(), name: s, icon: '', color, parentId: c.id, archived: false });
  };
  cat('Casa', '🏠', PALETTE[0], ['Affitto / Mutuo', 'Bollette', 'Manutenzione']);
  cat('Alimentari', '🛒', PALETTE[2], ['Supermercato', 'Mercato']);
  cat('Trasporti', '🚗', PALETTE[1], ['Carburante', 'Mezzi pubblici', 'Auto']);
  cat('Svago', '🎉', PALETTE[6], ['Ristoranti e bar', 'Viaggi', 'Abbonamenti']);
  cat('Salute', '💊', PALETTE[7], ['Farmacia', 'Visite']);
  cat('Shopping', '🛍️', PALETTE[4]);
  cat('Altro', '📦', PALETTE[3]);
  return {
    version: 1,
    settings: { currency: 'EUR', theme: 'auto', defaultThreshold: 80, lastAccountId: null },
    accounts: [
      acc('Contanti', 'cash', PALETTE[2]),
      acc('Conto personale', 'personal', PALETTE[0]),
      acc('Fineco (in comune)', 'shared', PALETTE[1]),
    ],
    categories,
    transactions: [],
    budgets: [],
  };
}

export function normalize(d) {
  const base = defaultData();
  return {
    version: 1,
    settings: { ...base.settings, ...(d.settings || {}) },
    accounts: d.accounts || [],
    categories: d.categories || [],
    transactions: d.transactions || [],
    budgets: d.budgets || [],
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {
    console.error('Dati salvati non leggibili', e);
  }
  return defaultData();
}

export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error('Salvataggio non riuscito', e);
    return false;
  }
}
