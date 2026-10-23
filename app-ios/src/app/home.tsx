import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Badge, Button, Card, Empty, Gap, H1, type IconName, Loader, Muted, Screen, Section, colors, useLoad } from '../components/ui';
import { fmtDate, planKindLabel, unitsText } from '../lib/format';
import { useSession } from '../session';
import type { Permission, UnifiedReport } from '../types';

interface Tile { label: string; icon: IconName; href: Href; perms?: Permission[]; admin?: boolean }

const STAFF_TILES: Tile[] = [
  { label: 'Escanear QR', icon: 'scan', href: '/scan', perms: ['attendance'] },
  { label: 'Autorizaciones', icon: 'hand-left', href: '/authorizations', perms: ['override_capacity', 'attendance'] },
  { label: 'Agenda', icon: 'calendar', href: '/bookings', perms: ['classes', 'bookings'] },
  { label: 'Clientes', icon: 'people', href: '/clients', perms: ['clients', 'attendance', 'reports', 'payments'] },
  { label: 'Pagos', icon: 'cash', href: '/payments', perms: ['payments'] },
  { label: 'Reportes', icon: 'bar-chart', href: '/reports', perms: ['reports', 'capacity_reports'] },
  { label: 'Planes', icon: 'pricetags', href: '/plans', perms: ['plans'] },
  { label: 'Sedes y espacios', icon: 'business', href: '/sites', perms: ['schedules'] },
  { label: 'Clases y profesores', icon: 'school', href: '/classes', perms: ['classes'] },
  { label: 'Academias', icon: 'library', href: '/academies', admin: true },
  { label: 'Usuarios', icon: 'key', href: '/users', admin: true },
  { label: 'Reglas de reserva', icon: 'options', href: '/settings', perms: ['booking_rules'] }, // RQ44
];

function TileGrid({ tiles }: { tiles: Tile[] }) {
  return (
    <View style={s.grid}>
      {tiles.map((t) => (
        <Pressable key={t.label} onPress={() => router.push(t.href)} style={({ pressed }) => [s.tile, pressed && { opacity: 0.7 }]} testID={`tile-${t.label}`}>
          <View style={s.tileIcon}>
            <Ionicons name={t.icon} size={24} color={colors.primary} />
          </View>
          <Text style={s.tileText}>{t.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function ProfileButton() {
  return (
    <Pressable onPress={() => router.push('/profile')} hitSlop={10} testID="profile-button">
      <Ionicons name="person-circle-outline" size={28} color="#fff" />
    </Pressable>
  );
}

function ClientHome() {
  const { user } = useSession();
  const report = useLoad<UnifiedReport>('/reports/me');
  return (
    <>
      <H1>Hola, {user!.fullName.split(' ')[0]}</H1>
      <Muted>{user!.academies.map((a) => a.name).join(' · ')}</Muted>
      <Gap />
      <Button label="Mostrar mi código QR" icon="qr-code" onPress={() => router.push('/my-qr')} testID="show-qr" />
      <Section title="Mis planes">
        <Loader state={report}>
          {(r) => {
            const current = r.memberships.filter((m) => m.is_current);
            if (!current.length) return <Empty text="No tienes un plan vigente. Acércate a tu academia para adquirir uno." icon="pricetag-outline" />;
            return current.map((m) => (
              <Card key={m.id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={s.planName}>{m.plan_name}</Text>
                  <Badge text={planKindLabel(m.kind)} />
                </View>
                <Text style={s.big}>{unitsText(m.remaining, m.units_total)}</Text>
                <Muted>{m.units_total == null ? 'Clases ilimitadas' : 'clases o reservas disponibles'} · vence {fmtDate(m.ends_on)}</Muted>
                <Muted style={{ marginTop: 4, fontSize: 12 }}>
                  {m.academies.map((a) => a.name).join(', ')} · {m.all_sites ? 'todas las sedes' : m.sites.map((x) => x.name).join(', ')}
                </Muted>
              </Card>
            ));
          }}
        </Loader>
      </Section>
      <Section title="Mi actividad">
        <TileGrid
          tiles={[
            { label: 'Mi reporte', icon: 'stats-chart', href: '/my-report' },
            { label: 'Horario de clases', icon: 'calendar', href: '/schedule' },
            { label: 'Mis reservas', icon: 'bookmark', href: '/my-bookings' },
            { label: 'Unirme a otra academia', icon: 'add-circle', href: '/join' },
          ]}
        />
      </Section>
    </>
  );
}

export default function Home() {
  const { user, isAdmin, can } = useSession();
  if (!user) return null;
  const tiles = STAFF_TILES.filter((t) => (t.admin ? isAdmin : can(...(t.perms ?? []))));
  return (
    <Screen title={user.tenant.name} right={<ProfileButton />}>
      {user.role === 'client' ? (
        <ClientHome />
      ) : (
        <>
          <H1>Hola, {user.fullName.split(' ')[0]}</H1>
          <Muted>{isAdmin ? 'Administrador' : 'Personal'} · {user.academies.length} academia(s)</Muted>
          <Gap />
          {tiles.length ? <TileGrid tiles={tiles} /> : <Empty text="Tu usuario aún no tiene permisos. Pide al administrador que te los asigne." />}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexGrow: 1, flexBasis: 150, maxWidth: 260, backgroundColor: colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 10 },
  tileIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  tileText: { fontSize: 15, fontWeight: '700', color: colors.text },
  planName: { fontSize: 16, fontWeight: '800', color: colors.text },
  big: { fontSize: 30, fontWeight: '800', color: colors.primary, marginTop: 6 },
});
