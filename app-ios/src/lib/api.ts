/**
 * Cliente HTTP de la API de AcademiaPass. Todos los datos viven en la base de datos de la nube (RQ24, RQ27):
 * la app solo guarda la sesion y la direccion del servidor.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const KEY_URL = 'academiapass.apiUrl';
const KEY_MODE = 'academiapass.serverMode';
const KEY_TOKEN = 'academiapass.token';

/**
 * Servidores configurados en app.json (expo.extra):
 *  - cloud  : apiUrlCloud, el servidor en la nube (Render). Datos compartidos por todos los telefonos.
 *  - local  : apiUrlLocal, el backend corriendo en un PC de la misma red Wi-Fi (pruebas).
 *  - custom : una direccion escrita a mano en la pantalla Servidor.
 */
export type ServerMode = 'cloud' | 'local' | 'custom';

export function presetUrl(mode: 'cloud' | 'local') {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
  return normalizeUrl((mode === 'cloud' ? extra.apiUrlCloud : extra.apiUrlLocal) ?? '');
}

const defaultMode = (): ServerMode => ((Constants.expoConfig?.extra?.defaultServer as ServerMode) === 'local' ? 'local' : 'cloud');

let apiUrl = '';
let serverMode: ServerMode = 'cloud';
let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export class ApiError extends Error {
  status: number;
  code?: string;
  data: any;
  constructor(status: number, message: string, data: any) {
    super(message);
    this.status = status;
    this.code = data?.code;
    this.data = data;
  }
}

/** En la web servida por el backend se usa siempre el mismo origen (la pagina ya viene de ese servidor) */
function sameOriginWeb() {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && !/:(8081|19006)$/.test(window.location.host)) {
    return window.location.origin;
  }
  return null;
}

export function normalizeUrl(u: string) {
  return u.trim().replace(/\/+$/, '').replace(/\/api$/, '');
}

export async function loadStored() {
  const [[, url], [, mode], [, t]] = await AsyncStorage.multiGet([KEY_URL, KEY_MODE, KEY_TOKEN]);
  token = t;
  const web = sameOriginWeb();
  if (web) {
    apiUrl = web;
    serverMode = 'custom';
  } else {
    serverMode = (mode as ServerMode) || defaultMode();
    // cloud/local siempre leen app.json, asi una nueva version del APK con otra URL aplica sola
    apiUrl = serverMode === 'custom' ? url ?? '' : presetUrl(serverMode);
  }
  return { apiUrl, token };
}

export const getApiUrl = () => apiUrl;
export const getServerMode = () => serverMode;
export const isWebSameOrigin = () => !!sameOriginWeb();
export const hasToken = () => !!token;

/** Cambia de servidor. Las cuentas y los datos de cada servidor son distintos, asi que se cierra la sesion */
export async function setServer(mode: ServerMode, customUrl?: string) {
  const next = mode === 'custom' ? normalizeUrl(customUrl ?? '') : presetUrl(mode);
  const changed = next !== apiUrl;
  serverMode = mode;
  apiUrl = next;
  await AsyncStorage.multiSet([[KEY_MODE, mode], [KEY_URL, mode === 'custom' ? next : '']]);
  if (changed) await setToken(null);
  return changed;
}

/** Inicia sesion en un servidor que aun no es el activo (pantalla Servidor). Devuelve token y perfil */
export async function loginAt(url: string, username: string, password: string) {
  let res: Response;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    res = await fetch(`${normalizeUrl(url)}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ApiError(0, (e as Error)?.name === 'AbortError' ? 'Ese servidor no respondió a tiempo' : 'No hay conexión con ese servidor', { code: 'NETWORK' });
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Error ${res.status}`, data);
  return data as { token: string; user: any };
}

/** Comprueba que en esa direccion responda un servidor de AcademiaPass */
export async function checkServer(url: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 70_000); // Render gratis tarda ~1 min en despertar
  try {
    const res = await fetch(`${normalizeUrl(url)}/api/health`, { signal: ctrl.signal });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) throw new Error(`El servidor respondió ${res.status} y no parece AcademiaPass`);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('El servidor no respondió en 70 segundos');
    if (e instanceof TypeError) throw new Error('No hay conexión con esa dirección (revisa la red, la IP o que el servidor esté encendido)');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function setToken(t: string | null) {
  token = t;
  if (t) await AsyncStorage.setItem(KEY_TOKEN, t);
  else await AsyncStorage.removeItem(KEY_TOKEN);
}

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

const REQUEST_TIMEOUT_MS = 60_000;

/** Nombre corto del servidor actual para mostrarlo en pantallas y mensajes */
export function serverLabel() {
  const mode = getServerMode();
  const kind = mode === 'cloud' ? 'Nube' : mode === 'local' ? 'Local' : 'Servidor';
  return `${kind} (${apiUrl || 'sin configurar'})`;
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  if (!apiUrl) throw new ApiError(0, 'Configura la dirección del servidor en "Servidor".', { code: 'NO_SERVER' });
  let res: Response;
  let text: string;
  // Tiempo limite: un servidor que acepta la conexion pero no responde (p. ej. Render apagado) dejaria la app
  // cargando para siempre. 60 s cubren el arranque en frio del plan gratuito de Render
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    res = await fetch(`${apiUrl}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    text = await res.text();
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      throw new ApiError(0, `El servidor ${serverLabel()} no respondió en ${REQUEST_TIMEOUT_MS / 1000} segundos. Si es la nube, puede estar apagada o despertando: intenta de nuevo en un minuto o cambia de servidor en "Servidor".`, { code: 'TIMEOUT' });
    }
    throw new ApiError(0, `No hay conexión con el servidor ${serverLabel()}. Revisa tu internet o la dirección en "Servidor".`, { code: 'NETWORK' });
  } finally {
    clearTimeout(timer);
  }
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    if (res.status === 401 && token && path !== '/auth/login') onUnauthorized?.();
    throw new ApiError(res.status, data?.error ?? `Error ${res.status}`, data);
  }
  return data as T;
}

export const get = <T = any>(path: string) => api<T>('GET', path);
export const post = <T = any>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});
export const put = <T = any>(path: string, body?: unknown) => api<T>('PUT', path, body ?? {});
export const del = <T = any>(path: string) => api<T>('DELETE', path);

/** Construye ?a=1&b=2 omitiendo valores vacios */
export function qs(params: Record<string, unknown>) {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? `?${p.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}` : '';
}
