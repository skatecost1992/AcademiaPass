import { router } from 'expo-router';
import React from 'react';
import { BookingList } from '../../components/BookingList';
import { Button, Gap, Loader, Muted, Screen, confirm, errorText, notify, useLoad } from '../../components/ui';
import { post, qs } from '../../lib/api';
import { addDays, money, today } from '../../lib/format';
import { useSession } from '../../session';
import type { Booking } from '../../types';

/** Reservas de espacios del cliente (RQ7) */
export default function MyBookings() {
  const { user } = useSession();
  const from = addDays(today(), -30);
  const list = useLoad<Booking[]>(`/bookings${qs({ from, to: addDays(today(), 120), kind: 'rental' })}`);
  const mine = (list.data ?? []).filter((b) => b.client_id === user?.id);

  const open = async (b: Booking) => {
    const future = new Date(b.starts_at) > new Date();
    const info = `${b.site_name} · ${b.space_name}\n${b.group_size} persona(s)\nPagado: ${money(b.paid)}`;
    if (!future || b.status === 'cancelled') return notify(b.title, info);
    if (await confirm(b.title, `${info}\n\n¿Quieres cancelar esta reserva?`, 'Cancelar reserva')) {
      try {
        await post(`/bookings/${b.id}/cancel`);
        await list.reload();
      } catch (e) {
        notify('No se pudo cancelar', errorText(e));
      }
    }
  };

  return (
    <Screen title="Mis reservas" onRefresh={list.reload} refreshing={list.loading}>
      <Button label="Reservar un espacio" icon="add" onPress={() => router.push('/my-bookings/new')} />
      <Gap />
      <Muted style={{ marginBottom: 6 }}>El pago de la reserva se registra en la recepción de la academia.</Muted>
      <Loader state={list}>{() => <BookingList bookings={mine} onPress={open} showMoney />}</Loader>
    </Screen>
  );
}
