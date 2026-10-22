/**
 * Sesion del usuario: perfil, permisos y acciones de inicio/cierre de sesion.
 */
import { router, useSegments } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { get, loadStored, post, setToken, setUnauthorizedHandler } from './lib/api';
import type { Permission, Profile } from './types';

interface Session {
  ready: boolean;
  user: Profile | null;
  isAdmin: boolean;
  isClient: boolean;
  can: (...perms: Permission[]) => boolean;
  signIn: (token: string, user: Profile) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: Profile) => void;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<Profile | null>(null);

  const signOut = useCallback(async () => {
    await setToken(null);
    setUser(null);
    if (router.canDismiss()) router.dismissAll();
    router.replace('/login');
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => void signOut());
    (async () => {
      const { token, apiUrl } = await loadStored();
      if (token && apiUrl) {
        try {
          setUser(await get<Profile>('/me'));
        } catch {
          // sin conexion o sesion vencida: se pide iniciar sesion de nuevo
        }
      }
      setReady(true);
    })();
  }, [signOut]);

  const value = useMemo<Session>(() => ({
    ready,
    user,
    isAdmin: user?.role === 'admin',
    isClient: user?.role === 'client',
    can: (...perms) => !!user && perms.some((p) => user.permissions.includes(p)),
    signIn: async (token, u) => {
      await setToken(token);
      setUser(u);
    },
    signOut,
    refresh: async () => setUser(await get<Profile>('/me')),
    setUser,
  }), [ready, user, signOut]);

  // Hasta leer la sesion guardada no se pinta ninguna pantalla: asi las que abren por enlace directo (web)
  // ya tienen la direccion del servidor y el token
  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: '#F1F5F4' }}>
        <ActivityIndicator size="large" color="#0F766E" />
      </View>
    );
  }
  return (
    <Ctx.Provider value={value}>
      <AuthGuard user={user} />
      {children}
    </Ctx.Provider>
  );
}

const PUBLIC = ['login', 'register', 'register-admin', 'server'];

/** Envia al ingreso si no hay sesion, o a la aceptacion de datos si esta pendiente (RQ14) */
function AuthGuard({ user }: { user: Profile | null }) {
  const segments = useSegments();
  const first = segments[0] ?? '';
  useEffect(() => {
    if (!first) return; // la pantalla inicial ya redirige
    if (!user && !PUBLIC.includes(first)) router.replace('/login');
    else if (user?.consentRequired && first !== 'consent') router.replace('/consent');
  }, [user, first]);
  return null;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession fuera de SessionProvider');
  return s;
}

/** Acepta el tratamiento de datos (RQ14) */
export async function acceptConsent() {
  return post<Profile>('/me/consent', { consent: true });
}
