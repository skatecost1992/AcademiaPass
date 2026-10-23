import { router } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Calendar } from '../../components/Calendar';
import { Badge, Button, Card, Empty, Gap, ListItem, Loader, Muted, RowWrap, Screen, Section, colors, confirm, errorText, notify, useLoad } from '../../components/ui';
import { post, qs } from '../../lib/api';
import { addDays, fmtRange, money, today } from '../../lib/format';

type State = 'attended' | 'cancelled' | 'deleted' | 'missed' | 'pending';

interface MyReservation {
  id: number; type: 'class' | 'rental'; booking_id: number; title: string; starts_at: string; ends_at: string;
  site_name: string; space_name: string; academy_name: string; teacher_name?: string | null; paid?: number; state: State;
}

const STATE: Record<State, [string, 'success' | 'muted' | 'danger' | 'accent' | 'primary']> = {
  attended: ['Asistida', 'success'],
  cancelled: ['Cancelada', 'muted'],
  deleted: ['Eliminada por la academia', 'danger'],
  missed: ['No asistió', 'accent'],
  pending: ['Pendiente', 'primary'],
};

/**
 * Mis reservas (RQ48, RQ49): cupos en clases y espacios con su estado, de la mas reciente a la mas antigua.
 * Sin filtro muestra las 20 mas recientes; con los calendarios desde/hasta consulta hasta un ano.
 */
export default function MyBookings() {
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [picking, setPicking] = useState<null | 'from' | 'to'>(null);
  const [draft, setDraft] = useState({ from: addDays(today(), -30), to: today() });
  const list = useLoad<{ total: number; truncated: boolean; rows: MyReservation[] }>(`/me/reservations${qs(range ?? {})}`);
  const days = (Date.parse(draft.to) - Date.parse(draft.from)) / 86400_000;
  const rangeError = draft.from > draft.to ? 'La fecha inicial es mayor que la final' : days > 366 ? 'El rango máximo es de un año' : null;

  const cancel = async (r: MyReservation) => {
    const label = r.type === 'class' ? 'tu cupo' : 'la reserva';
    if (!(await confirm(r.title, `${fmtRange(r.starts_at, r.ends_at)}\n${r.site_name} · ${r.space_name}\n\n¿Cancelar ${label}?`, 'Cancelar'))) return;
    try {
      await post(r.type === 'class' ? `/me/class-reservations/${r.id}/cancel` : `/bookings/${r.id}/cancel`);
      notify('Cancelada');
      await list.reload();
    } catch (e) {
      notify('No se pudo cancelar', errorText(e));
    }
  };

  return (
    <Screen title="Mis reservas" onRefresh={list.reload} refreshing={list.loading}>
      <RowWrap>
        <Button label="Reservar clase" icon="school-outline" onPress={() => router.push('/schedule')} />
        <Button label="Reservar espacio" icon="add" variant="secondary" onPress={() => router.push('/my-bookings/new')} />
      </RowWrap>

      <Section title="Consultar por fechas">
        <Card>
          <RowWrap>
            <Button small variant={picking === 'from' ? 'primary' : 'secondary'} icon="calendar-outline" label={`Desde ${draft.from}`} onPress={() => setPicking(picking === 'from' ? null : 'from')} />
            <Button small variant={picking === 'to' ? 'primary' : 'secondary'} icon="calendar-outline" label={`Hasta ${draft.to}`} onPress={() => setPicking(picking === 'to' ? null : 'to')} />
          </RowWrap>
          {picking ? (
            <View style={{ marginTop: 8 }}>
              <Calendar value={draft[picking]} onChange={(d) => { setDraft({ ...draft, [picking]: d }); setPicking(null); }}
                min={addDays(today(), -730)} max={addDays(today(), 365)} />
            </View>
          ) : null}
          {rangeError ? <Text style={{ color: colors.danger, marginTop: 6 }}>{rangeError}</Text> : null}
          <RowWrap style={{ marginTop: 8 }}>
            <Button small label="Consultar" icon="search" onPress={() => setRange(draft)} disabled={!!rangeError} />
            {range ? <Button small variant="ghost" label="Ver las 20 más recientes" onPress={() => setRange(null)} /> : null}
          </RowWrap>
        </Card>
      </Section>

      <Section title={range ? `Del ${range.from} al ${range.to}` : 'Las 20 más recientes'}>
        <Loader state={list}>
          {(d) => d.rows.length === 0 ? <Empty text="No tienes reservas en este periodo." icon="bookmark-outline" /> : (
            <>
              {d.rows.map((r) => (
                <ListItem
                  key={`${r.type}-${r.id}`}
                  icon={r.type === 'class' ? 'school-outline' : 'bookmark-outline'}
                  title={r.title}
                  subtitle={`${fmtRange(r.starts_at, r.ends_at)}\n${r.academy_name} · ${r.site_name} · ${r.space_name}${r.teacher_name ? ` · Prof. ${r.teacher_name}` : ''}${r.type === 'rental' && r.paid != null ? ` · pagado ${money(r.paid)}` : ''}`}
                  right={<Badge text={STATE[r.state][0]} tone={STATE[r.state][1]} />}
                  onPress={r.state === 'pending' ? () => cancel(r) : undefined}
                />
              ))}
              {d.truncated ? <Muted style={{ fontSize: 12 }}>Hay {d.total} reservas; se muestran {d.rows.length}. Usa los calendarios para consultar otro periodo.</Muted> : null}
            </>
          )}
        </Loader>
        <Gap h={4} />
        <Muted style={{ fontSize: 12 }}>
          Toca una reserva pendiente para cancelarla. No se pueden cancelar reservas ya tomadas ni vencidas; si reservaste una clase y no
          asististe, al terminar la clase se descuenta de tu plan.
        </Muted>
      </Section>
    </Screen>
  );
}
