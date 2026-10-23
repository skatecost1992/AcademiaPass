import React, { useState } from 'react';
import { Text } from 'react-native';
import { Badge, Button, Card, Chips, Empty, Field, InfoRow, Loader, Muted, RowWrap, Screen, colors, confirm, errorText, notify, useLoad } from '../../components/ui';
import { post, qs } from '../../lib/api';
import { fmtDateTime, fmtRange } from '../../lib/format';
import type { ScheduleRequest } from '../../types';

const STATUS: Record<ScheduleRequest['status'], { text: string; tone: 'accent' | 'success' | 'danger' | 'muted' }> = {
  pending: { text: 'Pendiente', tone: 'accent' },
  accepted: { text: 'Aceptada', tone: 'success' },
  rejected: { text: 'Rechazada', tone: 'danger' },
  cancelled: { text: 'Cancelada', tone: 'muted' },
};

/**
 * RQ66: solicitudes de cambio de horario entre profesores. El profesor responde desde el correo; el personal puede
 * responder por el (si lo acordaron en persona o no tiene correo) o cancelar la solicitud.
 */
export default function ScheduleRequests() {
  const [status, setStatus] = useState<ScheduleRequest['status'] | ''>('pending');
  const list = useLoad<ScheduleRequest[]>(`/schedule-requests${qs({ status: status || undefined })}`);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (r: ScheduleRequest, action: 'accept' | 'reject' | 'cancel') => {
    const labels = { accept: 'Aceptar el cambio', reject: 'Rechazar', cancel: 'Cancelar la solicitud' };
    const ok = await confirm(labels[action], action === 'accept'
      ? `Las sesiones de ${r.target_teacher_name} pasarán a la hora propuesta y se programará ${r.class_name}. ¿Lo confirmó el profesor?`
      : action === 'reject' ? `Se marcará como rechazada por ${r.target_teacher_name}.` : 'La solicitud dejará de estar pendiente.', labels[action]);
    if (!ok) return;
    setBusy(`${r.id}-${action}`);
    try {
      await post(`/schedule-requests/${r.id}/${action}`, action === 'cancel' ? {} : { note: notes[r.id] || null });
      notify(action === 'accept' ? 'Cambio aplicado' : action === 'reject' ? 'Solicitud rechazada' : 'Solicitud cancelada');
      void list.reload();
    } catch (e) {
      notify('No se pudo completar', errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen title="Cambios de horario" onRefresh={() => void list.reload()} refreshing={list.loading}>
      <Chips options={[{ value: 'pending' as const, label: 'Pendientes' }, { value: 'accepted' as const, label: 'Aceptadas' }, { value: 'rejected' as const, label: 'Rechazadas' }, { value: '' as const, label: 'Todas' }]}
        value={status} onChange={setStatus} />
      <Muted style={{ fontSize: 12, marginBottom: 8 }}>
        Se piden al crear una clase que se cruza con la de otro profesor. El profesor responde desde el enlace del correo.
      </Muted>
      <Loader state={list}>
        {(rows) => rows.length === 0 ? <Empty text="No hay solicitudes." icon="swap-horizontal" /> : rows.map((r) => (
          <Card key={r.id}>
            <RowWrap style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '700', color: colors.text, flexShrink: 1 }}>{r.class_name} → {r.target_teacher_name}</Text>
              <Badge text={STATUS[r.status].text} tone={STATUS[r.status].tone} />
            </RowWrap>
            <Muted style={{ fontSize: 12 }}>
              Pedida por {r.requested_by_name ?? '—'} el {fmtDateTime(r.created_at)}
              {r.requester_teacher_name ? ` para ${r.requester_teacher_name}` : ''}{r.status === 'pending' && !r.target_teacher_has_email ? ' · el profesor no tiene correo' : ''}
            </Muted>
            {r.message ? <Muted style={{ marginTop: 4 }}>"{r.message}"</Muted> : null}
            {r.items.map((i) => (
              <InfoRow key={i.id} label={`${i.title} (${i.space_name})`} value={`${fmtRange(i.starts_at, i.ends_at)}\n→ ${fmtRange(i.proposed_starts_at, i.proposed_ends_at)}`} />
            ))}
            {r.status !== 'pending' && r.resolved_at ? (
              <Muted style={{ fontSize: 12 }}>
                {STATUS[r.status].text} el {fmtDateTime(r.resolved_at)} {r.resolved_via === 'email' ? 'por el profesor (correo)' : r.resolved_by_name ? `por ${r.resolved_by_name}` : ''}
                {r.response_note ? ` · "${r.response_note}"` : ''}
              </Muted>
            ) : null}
            {r.status === 'pending' ? (
              <>
                <Field label="Nota (opcional)" value={notes[r.id] ?? ''} onChangeText={(v) => setNotes({ ...notes, [r.id]: v })} />
                <RowWrap>
                  <Button small label="Aceptar por el profesor" icon="checkmark" onPress={() => act(r, 'accept')} loading={busy === `${r.id}-accept`} />
                  <Button small label="Rechazar" variant="secondary" onPress={() => act(r, 'reject')} loading={busy === `${r.id}-reject`} />
                  <Button small label="Cancelar" variant="ghost" onPress={() => act(r, 'cancel')} loading={busy === `${r.id}-cancel`} />
                </RowWrap>
              </>
            ) : null}
          </Card>
        ))}
      </Loader>
    </Screen>
  );
}
