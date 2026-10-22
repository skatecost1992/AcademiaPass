import { router } from 'expo-router';
import React, { useState } from 'react';
import { BookingList } from '../../components/BookingList';
import { PlacePicker } from '../../components/shared';
import { Button, Chips, Field, Gap, Loader, RowWrap, Screen, useLoad } from '../../components/ui';
import { qs } from '../../lib/api';
import { addDays, isDate, today } from '../../lib/format';
import { useSession } from '../../session';
import type { Booking } from '../../types';

/** Agenda de clases y reservas por sede (RQ2, RQ10) */
export default function Bookings() {
  const { can } = useSession();
  const [academyId, setAcademyId] = useState<number | null>(null);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [from, setFrom] = useState(today());
  const [days, setDays] = useState(7);
  const [kind, setKind] = useState<'class' | 'rental' | null>(null);
  const valid = isDate(from);
  const list = useLoad<Booking[]>(valid ? `/bookings${qs({ from, to: addDays(from, days - 1), academyId, siteId, kind })}` : null);

  return (
    <Screen title="Agenda" onRefresh={list.reload} refreshing={list.loading}>
      <RowWrap>
        {can('classes') ? <Button label="Programar clase" icon="school-outline" onPress={() => router.push({ pathname: '/bookings/new', params: { kind: 'class' } })} /> : null}
        {can('bookings') ? <Button label="Reservar espacio" icon="bookmark-outline" variant="secondary" onPress={() => router.push({ pathname: '/bookings/new', params: { kind: 'rental' } })} /> : null}
      </RowWrap>
      <Gap />
      <PlacePicker academyId={academyId} siteId={siteId} allowAll onChange={(a, s) => { setAcademyId(a); setSiteId(s); }} />
      <Chips<'class' | 'rental' | null> label="Tipo" options={[{ value: null, label: 'Todo' }, { value: 'class', label: 'Clases' }, { value: 'rental', label: 'Reservas' }]} value={kind} onChange={setKind} />
      <RowWrap>
        <Button small variant="secondary" label="◀" onPress={() => setFrom(addDays(from, -days))} />
        <Button small variant={from === today() ? 'primary' : 'secondary'} label="Hoy" onPress={() => setFrom(today())} />
        <Button small variant="secondary" label="▶" onPress={() => setFrom(addDays(from, days))} />
        <Chips options={[{ value: 1, label: '1 día' }, { value: 7, label: '7 días' }, { value: 30, label: '30 días' }]} value={days} onChange={setDays} />
      </RowWrap>
      <Field label="Desde (AAAA-MM-DD)" value={from} onChangeText={setFrom} />
      <Loader state={list}>
        {(rows) => <BookingList bookings={rows} showMoney onPress={(b) => router.push({ pathname: '/bookings/[id]', params: { id: String(b.id) } })} />}
      </Loader>
    </Screen>
  );
}
