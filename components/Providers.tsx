"use client";

import { LanguageProvider } from "./LanguageContext";
import { AuthProvider } from "./AuthContext";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <AuthProvider>{children}</AuthProvider>
    </LanguageProvider>
  );
}
