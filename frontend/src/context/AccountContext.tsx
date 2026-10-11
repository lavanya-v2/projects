import { createContext } from "react";
import type { Account } from "../features/admin/accounts/types";


interface AccountContextType {
  accounts: Account[];
  activeAccount: Account | null;
  setActiveAccount: (account: Account) => void;
  isLoading: boolean;
  error: string | null;
}

export const AccountContext = createContext<AccountContextType | undefined>(undefined);