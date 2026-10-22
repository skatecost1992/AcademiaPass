import { router } from 'expo-router';
import React from 'react';
import { BookingList } from '../../components/BookingList';
import { Badge, Button, Empty, Gap, ListItem, Loader, Muted, RowWrap, Screen, Section, confirm, errorText, notify, useLoad } from '../../components/ui';
import { post, qs } from '../../lib/api';
import { addDays, fmtRange, money, today } from '../../lib/format';
import { useSession } from '../../session';
import type { Booking } from '../../types';

interface ClassReservation {
  id: number; booking_id: number; title: string; starts_at: string; ends_at: string; group_size: number; reserved: number;
  booking_status: string; site_name: string; space_name: string; academy_name: string; teacher_name: string | null;
}

/** Reservas del cliente: cupos en clases (RQ30-RQ32) y espacios reservados (RQ7) */
export default function MyBookings() {
  const { user } = useSession();
  const from = addDays(today(), -30);
  const list = useLoad<Booking[]>(`/bookings${qs({ from, to: addDays(today(), 120), kind: 'rental' })}`);
  const classes = useLoad<ClassReservation[]>('/me/class-reservations');
  const settings = useLoad<{ cancelHours: number }>('/settings');
  const mine = (list.data ?? []).filter((b) => b.client_id === user?.id);
  const hours = settings.data?.cancelHours;
  const rule = hours == null ? '' : hours === 0 ? 'Puedes cancelar hasta que empiece.' : `Puedes cancelar hasta ${hours % 24 === 0 ? `${hours / 24} día(s)` : `${hours} hora(s)`} antes del inicio.`;

  const reload = () => {
    void list.reload();
    void classes.reload();
  };

  const cancelClass = async (r: ClassReservation) => {
    if (!(await confirm(r.title, `${fmtRange(r.starts_at, r.ends_at)}\n${r.site_name} · ${r.space_name}\n\n¿Cancelar tu cupo?`, 'Cancelar cupo'))) return;
    try {
      await post(`/me/class-reservations/${r.id}/cancel`);
      notify('Cupo cancelado');
      reload();
    } catch (e) {
      notify('No se pudo cancelar', errorText(e));
    }
  };

  const open = async (b: Booking) => {
    const future = new Date(b.starts_at) > new Date();
    const info = `${b.site_name} · ${b.space_name}\n${b.group_size} persona(s)\nPagado: ${money(b.paid)}`;
    if (!future || b.status === 'cancelled') return notify(b.title, info);
    if (await confirm(b.title, `${info}\n\n¿Quieres cancelar esta reserva?`, 'Cancelar reserva')) {
      try {
        await post(`/bookings/${b.id}/cancel`);
        reload();
      } catch (e) {
        notify('No se pudo cancelar', errorText(e));
      }
    }
  };

  const upcoming = (classes.data ?? []).filter((r) => new Date(r.ends_at) > new Date());
  return (
    <Screen title="Mis reservas" onRefresh={reload} refreshing={list.loading || classes.loading}>
      <RowWrap>
        <Button label="Reservar clase" icon="school-outline" onPress={() => router.push('/schedule')} />
        <Button label="Reservar espacio" icon="add" variant="secondary" onPress={() => router.push('/my-bookings/new')} />
      </RowWrap>
      {rule ? <Muted style={{ marginTop: 10 }}>{rule}</Muted> : null}

      <Section title="Mis clases">
        <Loader state={classes}>
          {() => upcoming.length === 0 ? <Empty text="No tienes cupos reservados en clases." icon="school-outline" /> : upcoming.map((r) => (
            <ListItem
              key={r.id}
              icon="school-outline"
              title={r.title}
              subtitle={`${fmtRange(r.starts_at, r.ends_at)}\n${r.academy_name} · ${r.site_name} · ${r.space_name}${r.teacher_name ? ` · ${r.teacher_name}` : ''}`}
              right={r.booking_status === 'cancelled' ? <Badge text="Clase cancelada" tone="danger" /> : <Badge text={`${r.reserved}/${r.group_size}`} tone="success" />}
              onPress={() => cancelClass(r)}
            />
          ))}
        </Loader>
      </Section>

      <Section title="Mis espacios reservados">
        <Muted style={{ marginBottom: 6 }}>El pago de la reserva se registra en la recepción de la academia.</Muted>
        <Gap h={4} />
        <Loader state={list}>{() => <BookingList bookings={mine} onPress={open} showMoney />}</Loader>
      </Section>
    </Screen>
  );
}
