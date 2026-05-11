import { createContext, useContext } from "react";
import { useAppRoot, AppRootValue } from "../hooks/useAppRoot";

const AppContext = createContext<AppRootValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
   const value = useAppRoot();
   return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppRootValue {
   const ctx = useContext(AppContext);
   if (!ctx) throw new Error("useApp must be used inside AppProvider");
   return ctx;
}
