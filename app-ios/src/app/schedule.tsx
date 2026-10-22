import React, { useState } from 'react';
import { BookingList } from '../components/BookingList';
import { Chips, Loader, Muted, Screen, useLoad } from '../components/ui';
import { qs } from '../lib/api';
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
  return (
    <Screen title="Horario de clases" onRefresh={list.reload} refreshing={list.loading}>
      {user && user.academies.length > 1 ? (
        <Chips<number | null> label="Academia" options={[{ value: null, label: 'Todas' }, ...user.academies.map((a) => ({ value: a.id as number | null, label: a.name }))]} value={academyId} onChange={setAcademyId} />
      ) : null}
      <Chips label="Mostrar" options={[{ value: 1, label: 'Hoy' }, { value: 7, label: '7 días' }, { value: 30, label: '30 días' }]} value={days} onChange={setDays} />
      <Muted style={{ marginBottom: 8 }}>El número indica asistentes registrados / cupo de la clase.</Muted>
      <Loader state={list}>{(b) => <BookingList bookings={b} />}</Loader>
    </Screen>
  );
}
