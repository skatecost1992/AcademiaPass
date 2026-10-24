import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Badge, Button, Card, Empty, Gap, InfoRow, Loader, Screen, Section, confirm, errorText, notify, useLoad } from '../../components/ui';
import { post } from '../../lib/api';
import { cap, fmtDateTime, fmtRange, money } from '../../lib/format';
import { useSession } from '../../session';
import type { Booking } from '../../types';

interface Detail extends Booking {
  attendeeList: { id: number; scanned_at: string; over_capacity: boolean; client_id: number; full_name: string }[];
  reservationList: { id: number; created_at: string; client_id: number; full_name: string }[];
  payments: { id: number; amount: number; method: string; reference: string | null; paid_at: string }[];
}

export default function BookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can, user } = useSession();
  const d = useLoad<Detail>(`/bookings/${id}`);

  // RQ69: el profesor cancela su sesion con la anticipacion definida (cuenta como clase a la que no asistio); el
  // personal puede marcar ese mismo motivo al cancelar una clase
  const cancel = async (reason?: 'teacher_absent') => {
    const msg = user?.teacher
      ? '¿Cancelar tu sesión? Cuenta como clase a la que no pudiste asistir y se avisa a los clientes con cupo.'
      : reason ? '¿Cancelar la sesión porque el profesor no puede asistir? Se avisa a los clientes con cupo.' : '¿Cancelar esta clase o reserva? El espacio quedará libre.';
    if (!(await confirm('Cancelar', msg, 'Cancelar'))) return;
    try {
      await post(`/bookings/${id}/cancel`, reason ? { reason } : {});
      await d.reload();
    } catch (e) {
      notify('No se pudo cancelar', errorText(e));
    }
  };

  return (
    <Screen title="Detalle" onRefresh={d.reload} refreshing={d.loading}>
      <Loader state={d}>
        {(b) => (
          <>
            <Card>
              <Badge text={b.status === 'cancelled' ? 'Cancelada' : b.kind === 'class' ? 'Sesión de clase' : 'Reserva de espacio'} tone={b.status === 'cancelled' ? 'muted' : 'primary'} />
              <Gap h={6} />
              <InfoRow label="Título" value={b.title} />
              <InfoRow label="Horario" value={fmtRange(b.starts_at, b.ends_at)} />
              <InfoRow label="Lugar" value={`${b.academy_name} · ${b.site_name} · ${b.space_name}`} />
              {b.teacher_name ? <InfoRow label="Profesor" value={`${b.teacher_name} (${b.teacher_kind === 'external' ? 'externo' : 'interno'})`} /> : null}
              {b.client_name ? <InfoRow label="Cliente" value={b.client_name} /> : null}
              <InfoRow label="Asistentes / cupo" value={`${b.attendees} / ${b.group_size}`} />
              {b.kind === 'class' ? <InfoRow label="Cupos reservados" value={`${b.reserved} / ${b.group_size}`} /> : null}
              {b.notes ? <InfoRow label="Notas" value={b.notes} /> : null}
            </Card>
            {b.kind === 'class' ? (
              <Section title={`Cupos reservados (${b.reservationList.length})`}>
                {b.reservationList.length === 0 ? <Empty text="Nadie ha reservado cupo." icon="people-outline" /> : (
                  <Card>
                    {b.reservationList.map((r) => (
                      <InfoRow key={r.id} label={r.full_name} value={`${b.attendeeList.some((a) => a.client_id === r.client_id) ? 'Asistió' : 'Reservó'} · ${fmtDateTime(r.created_at)}`} />
                    ))}
                  </Card>
                )}
              </Section>
            ) : null}
            <Section title={`Asistentes (${b.attendeeList.length})`}>
              {b.attendeeList.length === 0 ? <Empty text="Nadie ha registrado ingreso." icon="people-outline" /> : (
                <Card>
                  {b.attendeeList.map((a) => (
                    <InfoRow key={a.id} label={a.full_name} value={`${fmtDateTime(a.scanned_at)}${a.over_capacity ? ' · fuera de aforo' : ''}`} />
                  ))}
                </Card>
              )}
            </Section>
            {b.kind === 'rental' ? (
              <Section title={`Pagos (${money(b.paid)})`} action={can('payments') && b.status !== 'cancelled' ? <Button small label="Registrar pago" icon="add" onPress={() => router.push({ pathname: '/payments/new', params: { bookingId: String(b.id) } })} /> : undefined}>
                {b.payments.length === 0 ? <Empty text="Sin pagos registrados." icon="cash-outline" /> : (
                  <Card>{b.payments.map((p) => <InfoRow key={p.id} label={`${fmtDateTime(p.paid_at)} · ${cap(p.method)}`} value={money(p.amount)} />)}</Card>
                )}
              </Section>
            ) : null}
            <Gap h={16} />
            {b.status !== 'cancelled' && can(b.kind === 'class' ? 'classes' : 'bookings') && (!user?.teacher || b.teacher_id === user.teacher.id) ? (
              <>
                <Button label="Cancelar" variant="danger" icon="close-circle-outline" onPress={() => cancel()} />
                {b.kind === 'class' && !user?.teacher && b.teacher_id ? (
                  <Button label="Cancelar: el profesor no puede asistir" variant="ghost" icon="person-remove-outline" onPress={() => cancel('teacher_absent')} />
                ) : null}
              </>
            ) : null}
          </>
        )}
      </Loader>
    </Screen>
  );
}
