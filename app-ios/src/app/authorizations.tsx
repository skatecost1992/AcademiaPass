import React, { useState } from 'react';
import { Badge, Button, Card, Chips, Empty, Gap, InfoRow, Loader, Muted, RowWrap, Screen, confirm, errorText, notify, useLoad } from '../components/ui';
import { post, qs } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { useSession } from '../session';

interface CapacityRequest {
  id: number; status: 'pending' | 'approved' | 'rejected'; created_at: string; resolved_at: string | null;
  client_name: string; booking_title: string | null; starts_at: string | null; group_size: number | null; attendees: number;
  site_name: string; requested_by_name: string | null; resolved_by_name: string | null;
}

const STATUS = { pending: ['Pendiente', 'accent'], approved: ['Aprobada', 'success'], rejected: ['Rechazada', 'muted'] } as const;

/**
 * Solicitudes para ingresar con el aforo completo (RQ37). Quien tiene el permiso de aforo las aprueba (se
 * registra el ingreso por fuera del aforo) o las rechaza; el resto del personal ve su estado.
 */
export default function Authorizations() {
  const { can } = useSession();
  const [status, setStatus] = useState<'pending' | 'all'>('pending');
  const list = useLoad<CapacityRequest[]>(`/attendance/requests${qs({ status })}`);
  const [busy, setBusy] = useState<number | null>(null);
  const canDecide = can('override_capacity');

  const decide = async (r: CapacityRequest, approve: boolean) => {
    const what = approve ? 'Aprobar y registrar el ingreso por fuera del aforo' : 'Rechazar la solicitud';
    if (!(await confirm(r.client_name, `${what}?\n\n${r.booking_title ?? ''} · ${r.site_name}\nAsistentes: ${r.attendees}/${r.group_size ?? '—'}`, approve ? 'Aprobar' : 'Rechazar'))) return;
    setBusy(r.id);
    try {
      await post(`/attendance/requests/${r.id}/${approve ? 'approve' : 'reject'}`);
      notify(approve ? 'Ingreso autorizado y registrado' : 'Solicitud rechazada');
      await list.reload();
    } catch (e) {
      notify('No se pudo completar', errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen title="Autorizaciones" onRefresh={list.reload} refreshing={list.loading}>
      <Muted>Ingresos solicitados cuando la clase o el espacio ya tenían el aforo completo.</Muted>
      <Gap h={8} />
      <Chips options={[{ value: 'pending' as const, label: 'Pendientes' }, { value: 'all' as const, label: 'Todas' }]} value={status} onChange={setStatus} />
      <Loader state={list}>
        {(rows) => rows.length === 0 ? <Empty text={status === 'pending' ? 'No hay solicitudes pendientes.' : 'No hay solicitudes.'} icon="hand-left-outline" /> : rows.map((r) => (
          <Card key={r.id}>
            <InfoRow label={r.client_name} value={<Badge text={STATUS[r.status][0]} tone={STATUS[r.status][1]} />} />
            <InfoRow label="Clase o reserva" value={`${r.booking_title ?? '—'}${r.starts_at ? ` · ${fmtDateTime(r.starts_at)}` : ''}`} />
            <InfoRow label="Sede" value={r.site_name} />
            <InfoRow label="Asistentes / cupo" value={`${r.attendees} / ${r.group_size ?? '—'}`} />
            <InfoRow label="Solicitó" value={`${r.requested_by_name ?? '—'} · ${fmtDateTime(r.created_at)}`} />
            {r.resolved_by_name ? <InfoRow label={r.status === 'approved' ? 'Autorizó' : 'Rechazó'} value={`${r.resolved_by_name} · ${fmtDateTime(r.resolved_at)}`} /> : null}
            {r.status === 'pending' && canDecide ? (
              <RowWrap style={{ marginTop: 8 }}>
                <Button small label="Aprobar ingreso" icon="checkmark" onPress={() => decide(r, true)} loading={busy === r.id} />
                <Button small label="Rechazar" variant="danger" onPress={() => decide(r, false)} disabled={busy === r.id} />
              </RowWrap>
            ) : null}
          </Card>
        ))}
      </Loader>
      {!canDecide ? <Muted style={{ fontSize: 12 }}>Solo los usuarios con permiso de aforo pueden aprobar o rechazar.</Muted> : null}
    </Screen>
  );
}
