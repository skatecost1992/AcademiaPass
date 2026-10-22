/**
 * Componentes visuales compartidos (Android, iOS y web).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput,
  type TextInputProps, View, type ViewStyle,
} from 'react-native';
import { get } from '../lib/api';

export const colors = {
  bg: '#F1F5F4',
  card: '#FFFFFF',
  border: '#DCE5E3',
  text: '#10231F',
  muted: '#5E726E',
  primary: '#0F766E',
  primarySoft: '#DDF3EF',
  accent: '#CA8A04',
  accentSoft: '#FEF3C7',
  success: '#15803D',
  successSoft: '#DCFCE7',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
};

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

// ---------------------------------------------------------------- Mensajes (Alert no funciona en la web)

export function notify(title: string, message?: string) {
  if (Platform.OS === 'web') window.alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}

export function confirm(title: string, message: string, okLabel = 'Aceptar'): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
      { text: okLabel, style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------- Datos

/** Carga un recurso de la API y lo recarga cada vez que la pantalla vuelve a tener foco */
export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const lastPath = useRef(path);

  // Si cambia el recurso, los datos anteriores ya no aplican (p. ej. otro reporte con otra forma)
  if (lastPath.current !== path) {
    lastPath.current = path;
    if (data !== null) setData(null);
  }

  const reload = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await get<T>(path);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(errorText(e));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path]);

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  return { data, loading, error, reload, setData };
}

/** Ejecuta una accion mostrando el error si falla; devuelve [ejecutar, ocupado] */
export function useAction<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (...args: A) => {
    setBusy(true);
    try {
      await fn(...args);
    } catch (e) {
      notify('No se pudo completar', errorText(e));
    } finally {
      setBusy(false);
    }
  }, [fn]);
  return [run, busy] as const;
}

// ---------------------------------------------------------------- Estructura

export function Screen({ title, children, scroll = true, right, onRefresh, refreshing = false, padded = true }: {
  title?: string; children: React.ReactNode; scroll?: boolean; right?: React.ReactNode; onRefresh?: () => void; refreshing?: boolean; padded?: boolean;
}) {
  const options = { ...(title ? { title } : {}), ...(right ? { headerRight: () => right } : {}) };
  const content = <View style={[styles.content, padded && { padding: 16 }]}>{children}</View>;
  return (
    <View style={styles.screen}>
      <Stack.Screen options={options} />
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
        >
          {content}
        </ScrollView>
      ) : content}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <View style={{ marginTop: 18 }}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

export function H1({ children }: { children: React.ReactNode }) {
  return <Text style={styles.h1}>{children}</Text>;
}

export function Muted({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

export function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? <Text style={styles.infoValue}>{value}</Text> : value}
    </View>
  );
}

export function ListItem({ title, subtitle, right, onPress, icon, testID, muted }: {
  title: string; subtitle?: string | null; right?: React.ReactNode; onPress?: () => void; icon?: IconName; testID?: string; muted?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} testID={testID} style={({ pressed }) => [styles.item, pressed && onPress && { opacity: 0.7 }, muted && { opacity: 0.55 }]}>
      {icon ? (
        <View style={styles.itemIcon}>
          <Ionicons name={icon} size={20} color={colors.primary} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.itemTitle}>{title}</Text>
        {subtitle ? <Text style={styles.itemSub}>{subtitle}</Text> : null}
      </View>
      {right}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
    </Pressable>
  );
}

export function Badge({ text, tone = 'primary' }: { text: string; tone?: 'primary' | 'accent' | 'success' | 'danger' | 'muted' }) {
  const map = {
    primary: [colors.primarySoft, colors.primary],
    accent: [colors.accentSoft, colors.accent],
    success: [colors.successSoft, colors.success],
    danger: [colors.dangerSoft, colors.danger],
    muted: ['#EEF2F1', colors.muted],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{text}</Text>
    </View>
  );
}

export function Kpi({ label, value, icon, tone = 'primary' }: { label: string; value: string | number; icon?: IconName; tone?: 'primary' | 'accent' | 'success' | 'danger' }) {
  const color = { primary: colors.primary, accent: colors.accent, success: colors.success, danger: colors.danger }[tone];
  return (
    <View style={styles.kpi}>
      {icon ? <Ionicons name={icon} size={18} color={color} /> : null}
      <Text style={[styles.kpiValue, { color }]}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

export const KpiRow = ({ children }: { children: React.ReactNode }) => <View style={styles.kpiRow}>{children}</View>;

export function Empty({ text, icon = 'file-tray-outline' }: { text: string; icon?: IconName }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={30} color={colors.muted} />
      <Text style={[styles.muted, { textAlign: 'center', marginTop: 6 }]}>{text}</Text>
    </View>
  );
}

export function Loading() {
  return <ActivityIndicator style={{ marginVertical: 30 }} color={colors.primary} size="large" />;
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <View style={styles.errorBox}>
      <Text style={{ color: colors.danger, flex: 1 }}>{error}</Text>
      {onRetry ? <Button label="Reintentar" variant="ghost" onPress={onRetry} /> : null}
    </View>
  );
}

/** Estado de carga estandar de una pantalla: spinner, error o contenido */
export function Loader<T>({ state, children }: { state: { data: T | null; loading: boolean; error: string | null; reload: () => void }; children: (d: T) => React.ReactNode }) {
  if (state.error && !state.data) return <ErrorBox error={state.error} onRetry={state.reload} />;
  if (!state.data) return <Loading />;
  return <>{children(state.data)}</>;
}

// ---------------------------------------------------------------- Formularios

export function Button({ label, onPress, variant = 'primary', icon, loading, disabled, testID, small, style }: {
  label: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; icon?: IconName; loading?: boolean;
  disabled?: boolean; testID?: string; small?: boolean; style?: ViewStyle;
}) {
  const v = {
    primary: { bg: colors.primary, fg: '#fff', border: colors.primary },
    secondary: { bg: colors.card, fg: colors.primary, border: colors.primary },
    danger: { bg: colors.card, fg: colors.danger, border: colors.danger },
    ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
  }[variant];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      testID={testID}
      accessibilityRole="button"
      style={({ pressed }) => [styles.btn, small && styles.btnSmall, { backgroundColor: v.bg, borderColor: v.border }, (pressed || off) && { opacity: 0.6 }, style]}
    >
      {loading ? <ActivityIndicator color={v.fg} size="small" /> : icon ? <Ionicons name={icon} size={small ? 15 : 18} color={v.fg} /> : null}
      <Text style={[styles.btnText, small && { fontSize: 13 }, { color: v.fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, error, hint, style, ...props }: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor="#94A3A0"
        autoCorrect={false}
        {...props}
        style={[styles.input, props.multiline && { minHeight: 80, textAlignVertical: 'top' }, error ? { borderColor: colors.danger } : null, style]}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export interface Option<T> { value: T; label: string }

/** Selector de opciones en chips. Con `multi` permite varias */
export function Chips<T extends string | number | null>({ label, options, value, onChange, multi, values, onChangeMulti, hint }: {
  label?: string; options: Option<T>[]; value?: T; onChange?: (v: T) => void; multi?: boolean; values?: T[]; onChangeMulti?: (v: T[]) => void; hint?: string;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.chips}>
        {options.length === 0 ? <Muted>Sin opciones</Muted> : null}
        {options.map((o) => {
          const on = multi ? !!values?.includes(o.value) : value === o.value;
          return (
            <Pressable
              key={String(o.value)}
              onPress={() => {
                if (multi) onChangeMulti?.(on ? values!.filter((x) => x !== o.value) : [...(values ?? []), o.value]);
                else onChange?.(o.value);
              }}
              style={[styles.chip, on && styles.chipOn]}
            >
              {multi && on ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
              <Text style={[styles.chipText, on && { color: '#fff' }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <View style={styles.toggle}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { marginBottom: 0 }]}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary, false: '#CBD5D3' }} thumbColor="#fff" />
    </View>
  );
}

export function Checkbox({ checked, onChange, children, testID }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; testID?: string }) {
  return (
    <Pressable onPress={() => onChange(!checked)} style={styles.checkRow} testID={testID} accessibilityRole="checkbox" accessibilityState={{ checked }}>
      <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={24} color={checked ? colors.primary : colors.muted} />
      <Text style={{ flex: 1, color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 2 }}>{children}</Text>
    </Pressable>
  );
}

export const Gap = ({ h = 12 }: { h?: number }) => <View style={{ height: h }} />;
export const RowWrap = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => <View style={[styles.rowWrap, style]}>{children}</View>;

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { width: '100%', maxWidth: 860, alignSelf: 'center' },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  h1: { fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: 4 },
  muted: { color: colors.muted, fontSize: 14 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, gap: 12 },
  infoLabel: { color: colors.muted, fontSize: 14 },
  infoValue: { color: colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  itemIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  itemSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  kpiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpi: { flexGrow: 1, flexBasis: 140, backgroundColor: colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 2 },
  kpiValue: { fontSize: 24, fontWeight: '800' },
  kpiLabel: { fontSize: 12, color: colors.muted },
  empty: { alignItems: 'center', padding: 24 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.dangerSoft, padding: 12, borderRadius: 12, marginVertical: 10 },
  btn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1.5 },
  btnSmall: { paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10 },
  btnText: { fontSize: 15, fontWeight: '700' },
  label: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: colors.text },
  errorText: { color: colors.danger, fontSize: 12, marginTop: 4 },
  hint: { color: colors.muted, fontSize: 12, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12 },
  checkRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginVertical: 8 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
});
