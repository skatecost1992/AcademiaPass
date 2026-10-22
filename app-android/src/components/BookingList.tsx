import React from 'react';
import { Text, View } from 'react-native';
import { fmtTime } from '../lib/format';
import type { Booking } from '../types';
import { Badge, Empty, ListItem, colors } from './ui';

/** Lista de clases/reservas agrupadas por dia */
export function BookingList({ bookings, onPress, showMoney }: { bookings: Booking[]; onPress?: (b: Booking) => void; showMoney?: boolean }) {
  if (!bookings.length) return <Empty text="No hay clases ni reservas en estas fechas." icon="calendar-outline" />;
  const days = new Map<string, Booking[]>();
  for (const b of bookings) {
    const d = new Date(b.starts_at);
    const key = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
    days.set(key, [...(days.get(key) ?? []), b]);
  }
  return (
    <View>
      {[...days.entries()].map(([day, list]) => (
        <View key={day} style={{ marginBottom: 6 }}>
          <Text style={{ fontWeight: '800', color: colors.muted, marginVertical: 6, textTransform: 'capitalize' }}>{day}</Text>
          {list.map((b) => {
            // Clases que aun no empiezan: cuenta cupos reservados; las demas, asistentes registrados
            const upcomingClass = b.kind === 'class' && new Date(b.starts_at) > new Date();
            const used = upcomingClass ? Math.max(b.reserved ?? 0, b.attendees) : b.attendees;
            const full = used >= b.group_size;
            const who = b.kind === 'class' ? b.teacher_name && `Prof. ${b.teacher_name}${b.teacher_kind === 'external' ? ' (externo)' : ''}` : b.client_name ?? b.teacher_name;
            return (
              <ListItem
                key={b.id}
                icon={b.kind === 'class' ? 'school-outline' : 'bookmark-outline'}
                title={`${fmtTime(b.starts_at)}–${fmtTime(b.ends_at)} · ${b.title}`}
                subtitle={[b.site_name, b.space_name, who].filter(Boolean).join(' · ')}
                muted={b.status === 'cancelled'}
                onPress={onPress ? () => onPress(b) : undefined}
                right={
                  b.status === 'cancelled' ? <Badge text="Cancelada" tone="muted" /> : (
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Badge text={`${used}/${b.group_size}${full ? ' lleno' : ''}`} tone={full ? 'danger' : 'success'} />
                      {b.my_reservation_id ? <Badge text="Tu cupo" tone="primary" /> : null}
                      {showMoney && b.kind === 'rental' ? <Badge text={b.paid > 0 ? 'Pagada' : 'Sin pago'} tone={b.paid > 0 ? 'success' : 'accent'} /> : null}
                    </View>
                  )
                }
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}
