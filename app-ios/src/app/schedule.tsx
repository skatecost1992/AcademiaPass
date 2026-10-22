import React, { useState } from 'react';
import { BookingList } from '../components/BookingList';
import { Chips, Loader, Muted, Screen, confirm, errorText, notify, useLoad } from '../components/ui';
import { post, qs } from '../lib/api';
import { addDays, today } from '../lib/format';
import { useSession } from '../session';
import type { Booking } from '../types';

/** Horario de clases de las academias del cliente */
export default function Schedule() {
  const { user } = useSession();
  const [academyId, setAcademyId] = useState<number | null>(null);
  const [days, setDays] = useState(7);
  const from = today();
  const list = useLoad<Booking[]>(`/bookings${qs({ from, to: addDays(from, days - 1), kind: 'class', academyId })}`);
  // Reserva o cancela el cupo (RQ30-RQ32: el servidor valida plan, cupo y limite de cancelacion)
  const toggle = async (b: Booking) => {
    const mine = b.my_reservation_id;
    const msg = `${b.site_name} · ${b.space_name}
Cupos reservados: ${b.reserved}/${b.group_size}`;
    if (!(await confirm(b.title, mine ? `${msg}

¿Cancelar tu cupo?` : `${msg}

¿Reservar un cupo?`, mine ? 'Cancelar cupo' : 'Reservar'))) return;
    try {
      if (mine) await post(`/me/class-reservations/${mine}/cancel`);
      else await post('/me/class-reservations', { bookingId: b.id });
      notify(mine ? 'Cupo cancelado' : 'Cupo reservado');
      await list.reload();
    } catch (e) {
      notify('No se pudo completar', errorText(e));
    }
  };

  return (
    <Screen title="Horario de clases" onRefresh={list.reload} refreshing={list.loading}>
      {user && user.academies.length > 1 ? (
        <Chips<number | null> label="Academia" options={[{ value: null, label: 'Todas' }, ...user.academies.map((a) => ({ value: a.id as number | null, label: a.name }))]} value={academyId} onChange={setAcademyId} />
      ) : null}
      <Chips label="Mostrar" options={[{ value: 1, label: 'Hoy' }, { value: 7, label: '7 días' }, { value: 30, label: '30 días' }]} value={days} onChange={setDays} />
      <Muted style={{ marginBottom: 8 }}>Toca una clase para reservar o cancelar tu cupo. Necesitas un plan vigente de esa academia y sede.</Muted>
      <Loader state={list}>{(b) => <BookingList bookings={b} onPress={toggle} />}</Loader>
    </Screen>
  );
}
