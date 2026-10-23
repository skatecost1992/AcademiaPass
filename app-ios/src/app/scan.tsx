/**
 * Registro de ingresos (RQ7, RQ16, RQ20). Antes de escanear se elige academia, sede y la clase o reserva del
 * momento: con eso el servidor descuenta del plan que corresponde a esa academia y valida el aforo.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useRef, useState } from 'react';
import { Platform, StyleSheet, Text, Vibration, View } from 'react-native';
import { PlacePicker } from '../components/shared';
import { Badge, Button, Card, Chips, Field, Gap, ListItem, Muted, Screen, Section, colors, useLoad } from '../components/ui';
import { ApiError, post, qs } from '../lib/api';
import { fmtDate, fmtTime, today } from '../lib/format';
import { useSession } from '../session';
import type { Booking, ClientRow } from '../types';

interface ScanResult {
  ok: boolean;
  client?: { id: number; fullName: string; document?: string };
  membership?: { planName: string; remainingAfter: number | null; endsOn: string } | null;
  paidRental?: boolean;
  booking?: { title: string } | null;
  overCapacity?: boolean;
  error?: string;
  code?: string;
  reasons?: string[];
  canOverride?: boolean;
  contacts?: Contact[];
}

interface Contact { id: number; fullName: string; phone: string | null; email: string | null; role: string }

type Who = { qrToken: string } | { clientId: number };

/** Personas de la academia que pueden autorizar el ingreso (RQ37) */
function ContactList({ contacts }: { contacts: Contact[] }) {
  if (!contacts.length) return <Muted style={{ marginTop: 6 }}>No hay usuarios con permiso de aforo. Pide al administrador que asigne ese permiso.</Muted>;
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={[s.line, { fontWeight: '700' }]}>Comunícate con quien puede autorizar:</Text>
      {contacts.map((c) => (
        <Text key={c.id} style={[s.line, { fontSize: 13 }]}>
          • {c.fullName}{c.role === 'admin' ? ' (administrador)' : ''}{c.phone ? ` · ${c.phone}` : ''}{c.email ? ` · ${c.email}` : ''}
        </Text>
      ))}
    </View>
  );
}

function ResultCard({ r, onOverride, onRequest, requested, busy }: { r: ScanResult; onOverride: () => void; onRequest: () => void; requested: boolean; busy: boolean }) {
  const tone = r.ok ? (r.overCapacity ? colors.accent : colors.success) : colors.danger;
  return (
    <View style={[s.result, { borderColor: tone, backgroundColor: r.ok ? (r.overCapacity ? colors.accentSoft : colors.successSoft) : colors.dangerSoft }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Ionicons name={r.ok ? 'checkmark-circle' : r.code === 'CAPACITY_FULL' ? 'people-circle' : 'close-circle'} size={40} color={tone} />
        <View style={{ flex: 1 }}>
          <Text style={[s.resultTitle, { color: tone }]}>{r.ok ? 'Ingreso registrado' : r.code === 'CAPACITY_FULL' ? 'Aforo completo' : 'Ingreso rechazado'}</Text>
          {r.client ? <Text style={s.resultName}>{r.client.fullName}</Text> : null}
        </View>
      </View>
      {r.ok ? (
        <View style={{ marginTop: 8 }}>
          {r.booking ? <Text style={s.line}>{r.booking.title}</Text> : <Text style={s.line}>Ingreso general</Text>}
          {r.membership ? (
            <Text style={s.line}>
              Plan {r.membership.planName}: {r.membership.remainingAfter == null ? 'ilimitado' : `quedan ${r.membership.remainingAfter} clases`} · vence {fmtDate(r.membership.endsOn)}
            </Text>
          ) : r.paidRental ? <Text style={s.line}>Reserva propia pagada: no descuenta del plan</Text> : null}
          {r.overCapacity ? <Badge text="Registrado por fuera del aforo" tone="accent" /> : null}
        </View>
      ) : (
        <View style={{ marginTop: 8 }}>
          <Text style={s.line}>{r.error}</Text>
          {r.reasons?.map((x) => <Text key={x} style={[s.line, { fontSize: 13 }]}>• {x}</Text>)}
          {r.code === 'CAPACITY_FULL' ? (
            r.canOverride
              ? <Button label="Permitir ingreso fuera del aforo" variant="danger" icon="alert-circle-outline" onPress={onOverride} loading={busy} style={{ marginTop: 10 }} />
              : (
                <>
                  <ContactList contacts={r.contacts ?? []} />
                  {requested
                    ? <Badge text="Solicitud enviada: queda pendiente en Autorizaciones" tone="accent" />
                    : <Button label="Solicitar autorización" icon="hand-left-outline" onPress={onRequest} loading={busy} style={{ marginTop: 10 }} />}
                </>
              )
          ) : null}
        </View>
      )}
    </View>
  );
}

export default function Scan() {
  const { can } = useSession();
  const [academyId, setAcademyId] = useState<number | null>(null);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [bookingId, setBookingId] = useState<number | null>(null);
  const [mode, setMode] = useState<'camera' | 'manual'>('camera');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(false);
  const last = useRef<Who | null>(null);
  const locked = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();

  const d = today();
  const sessions = useLoad<Booking[]>(siteId ? `/bookings${qs({ siteId, from: d, to: d })}` : null);
  const clients = useLoad<ClientRow[]>(mode === 'manual' && query.trim().length >= 2 ? `/clients${qs({ q: query.trim(), academyId })}` : null);
  const ready = !!academyId && !!siteId;

  const register = async (who: Who, override = false) => {
    if (!ready) return;
    last.current = who;
    setBusy(true);
    try {
      const r = await post<ScanResult>('/attendance/scan', { ...who, academyId, siteId, bookingId, override });
      setResult(r);
      void sessions.reload();
    } catch (e) {
      const data = e instanceof ApiError ? e.data : null;
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e), code: data?.code, reasons: data?.reasons, canOverride: data?.canOverride, contacts: data?.contacts, client: data?.client });
    } finally {
      setBusy(false);
    }
  };

  const onScanned = ({ data }: { data: string }) => {
    if (locked.current || busy || result) return;
    locked.current = true;
    Vibration.vibrate(60); // aviso inmediato de que la camara leyo un codigo
    void register({ qrToken: data.trim() }).finally(() => { locked.current = false; });
  };

  // RQ37: deja la solicitud pendiente para quien puede autorizar el ingreso
  const requestAuthorization = async () => {
    if (!result?.client || !bookingId) return;
    setBusy(true);
    try {
      await post('/attendance/requests', { clientId: result.client.id, academyId, siteId, bookingId });
      setRequested(true);
    } catch (e) {
      setResult({ ...result, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    setRequested(false);
    setResult(null);
    setQuery('');
  };

  return (
    <Screen title="Registrar ingreso">
      <Section title="1. Lugar">
        <PlacePicker academyId={academyId} siteId={siteId} requireSite onChange={(a, si) => { setAcademyId(a); setSiteId(si); setBookingId(null); setResult(null); }} />
      </Section>
      {ready ? (
        <Section title="2. Clase o reserva de hoy">
          <Chips<number | null>
            options={[
              { value: null, label: 'Ingreso general' },
              ...(sessions.data ?? []).map((b) => ({ value: b.id as number | null, label: `${fmtTime(b.starts_at)} ${b.title} (${b.attendees}/${b.group_size})` })),
            ]}
            value={bookingId}
            onChange={(v) => { setBookingId(v); setResult(null); }}
            hint="Ingreso general descuenta de planes de acceso, asesorías o clases. Una clase valida además su cupo y el aforo del espacio."
          />
        </Section>
      ) : <Muted>Selecciona la academia y la sede para empezar.</Muted>}

      {ready ? (
        <Section title="3. Cliente">
          <Chips options={[{ value: 'camera' as const, label: 'Escanear QR' }, { value: 'manual' as const, label: 'Buscar por documento' }]} value={mode} onChange={(m) => { setMode(m); setResult(null); }} />
          {result ? (
            <>
              <ResultCard r={result} busy={busy} requested={requested} onRequest={requestAuthorization} onOverride={() => last.current && register(last.current, true)} />
              <Button label="Registrar otro" icon="scan" onPress={next} />
            </>
          ) : mode === 'camera' ? (
            !permission ? null : !permission.granted ? (
              <Card>
                <Muted>Se necesita la cámara para leer el código QR.</Muted>
                <Gap h={8} />
                <Button label="Permitir cámara" onPress={requestPermission} />
              </Card>
            ) : (
              <View style={s.cameraBox}>
                <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={busy ? undefined : onScanned} />
                <View style={s.frame} pointerEvents="none" />
                {busy ? <Text style={s.cameraHint}>Código leído, validando…</Text> : <Text style={s.cameraHint}>Apunta al QR del cliente a 15–25 cm</Text>}
              </View>
            )
          ) : (
            <View>
              <Field label="Nombre o documento" value={query} onChangeText={setQuery} autoCapitalize="none" />
              {(clients.data ?? []).slice(0, 10).map((c) => (
                <ListItem key={c.id} icon="person-outline" title={c.full_name} subtitle={`Doc. ${c.document}`} onPress={() => register({ clientId: c.id })} />
              ))}
            </View>
          )}
          {Platform.OS === 'web' && mode === 'camera' && !result ? <Muted style={{ marginTop: 6, fontSize: 12 }}>En el navegador la lectura del QR requiere HTTPS y permiso de cámara.</Muted> : null}
          {!can('override_capacity') ? <Muted style={{ marginTop: 8, fontSize: 12 }}>No tienes permiso para autorizar ingresos por fuera del aforo.</Muted> : null}
        </Section>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  cameraBox: { height: 340, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  frame: { width: 220, height: 220, borderWidth: 3, borderColor: '#fff', borderRadius: 18 },
  cameraHint: { position: 'absolute', bottom: 14, color: '#fff', fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  result: { borderWidth: 2, borderRadius: 16, padding: 16, marginBottom: 12 },
  resultTitle: { fontSize: 18, fontWeight: '800' },
  resultName: { fontSize: 16, fontWeight: '700', color: colors.text },
  line: { color: colors.text, fontSize: 14, marginTop: 4 },
});
