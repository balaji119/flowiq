import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { AuthSession } from '../types';
import { applyAuthToken, fetchCurrentSession, login as loginRequest } from '../services/authApi';

type AuthContextValue = {
  session: AuthSession | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const STORAGE_KEY = 'adsconnect-auth-session';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function setStoredValue(value: string | null) {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') {
      return;
    }

    if (value === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, value);
    }
    return;
  }

  if (value === null) {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } else {
    await AsyncStorage.setItem(STORAGE_KEY, value);
  }
}

async function getStoredValue() {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') {
      return null;
    }

    return window.localStorage.getItem(STORAGE_KEY);
  }

  return AsyncStorage.getItem(STORAGE_KEY);
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const stored = await getStoredValue();
        if (!stored || !active) {
          return;
        }

        const parsed = JSON.parse(stored) as AuthSession;
        applyAuthToken(parsed.token);
        const user = await fetchCurrentSession();

        if (!active) {
          return;
        }

        setSession({
          token: parsed.token,
          user,
        });
      } catch {
        applyAuthToken(null);
        await setStoredValue(null);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    bootstrap();

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      login: async (email: string, password: string) => {
        const nextSession = await loginRequest(email, password);
        applyAuthToken(nextSession.token);
        setSession(nextSession);
        await setStoredValue(JSON.stringify(nextSession));
      },
      logout: async () => {
        applyAuthToken(null);
        setSession(null);
        await setStoredValue(null);
      },
    }),
    [loading, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}
