import { useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Account } from '../features/admin/accounts/types';
import { useAccountsQuery } from '../features/admin/accounts/hooks';
import { AccountContext } from './AccountContext';

const STORAGE_KEY = 'activeAccountId';

export const AccountProvider = ({ children }: { children: ReactNode }) => {
 const { data: accounts = [], isLoading, isError } = useAccountsQuery();
 const error = isError ? 'Failed to load accounts from backend.' : null;

  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(()=>{
    const storedId = localStorage.getItem(STORAGE_KEY);
    return storedId ? Number(storedId) : null;
  });

  const activeAccount = accounts.find(a => a.id === selectedAccountId) ?? accounts[0] ?? null;

  const setActiveAccount = useCallback((account: Account) => {
    setSelectedAccountId(account.id);
    localStorage.setItem(STORAGE_KEY, String(account.id));
  }, []);

  return (
    <AccountContext.Provider value={{ accounts, activeAccount, setActiveAccount, isLoading, error }}>
      {children}
    </AccountContext.Provider>
  );
};
