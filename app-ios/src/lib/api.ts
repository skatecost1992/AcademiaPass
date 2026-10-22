/**
 * Cliente HTTP de la API de AcademiaPass. Todos los datos viven en la base de datos de la nube (RQ24, RQ27):
 * la app solo guarda la sesion y la direccion del servidor.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const KEY_URL = 'academiapass.apiUrl';
const KEY_TOKEN = 'academiapass.token';

let apiUrl = '';
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

/** Direccion por defecto: en la web servida por el backend, el mismo origen; en el telefono, app.json extra.apiUrl */
function defaultUrl() {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && !/:(8081|19006)$/.test(window.location.host)) {
    return window.location.origin;
  }
  return (Constants.expoConfig?.extra?.apiUrl as string) || '';
}

export const normalizeUrl = (u: string) => u.trim().replace(/\/+$/, '').replace(/\/api$/, '');

export async function loadStored() {
  const [[, url], [, t]] = await AsyncStorage.multiGet([KEY_URL, KEY_TOKEN]);
  apiUrl = url || defaultUrl();
  token = t;
  return { apiUrl, token };
}

export const getApiUrl = () => apiUrl;
export const hasToken = () => !!token;

export async function setApiUrl(url: string) {
  apiUrl = normalizeUrl(url);
  await AsyncStorage.setItem(KEY_URL, apiUrl);
}

export async function setToken(t: string | null) {
  token = t;
  if (t) await AsyncStorage.setItem(KEY_TOKEN, t);
  else await AsyncStorage.removeItem(KEY_TOKEN);
}

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  if (!apiUrl) throw new ApiError(0, 'Configura la dirección del servidor en "Servidor".', { code: 'NO_SERVER' });
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'No hay conexión con el servidor. Revisa tu internet o la dirección del servidor.', { code: 'NETWORK' });
  }
  const text = await res.text();
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
