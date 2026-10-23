import React, { useState } from 'react';
import { Badge, Button, Card, Chips, Empty, InfoRow, Loader, Muted, RowWrap, Screen, confirm, errorText, notify, useLoad } from '../components/ui';
import { post, qs } from '../lib/api';
import { fmtDateTime } from '../lib/format';

interface Tenant {
  id: number; name: string; status: 'pending' | 'active' | 'rejected'; created_at: string; reviewed_at: string | null;
  academies: number; clients: number;
  admin: { username: string; full_name: string; email: string | null; phone: string | null } | null;
}

const STATUS = { pending: ['Pendiente', 'accent'], active: ['Activa', 'success'], rejected: ['Rechazada', 'danger'] } as const;

/** Administrador general (RQ58): activa o rechaza las organizaciones que se registran */
export default function Organizations() {
  const [status, setStatus] = useState<'pending' | 'all'>('pending');
  const list = useLoad<Tenant[]>(`/platform/tenants${qs({ status })}`);
  const [busy, setBusy] = useState<number | null>(null);

  const review = async (t: Tenant, approve: boolean) => {
    if (!(await confirm(t.name, approve ? '¿Activar esta organización? Su administrador podrá ingresar.' : '¿Rechazar esta organización? Su administrador no podrá ingresar.', approve ? 'Activar' : 'Rechazar'))) return;
    setBusy(t.id);
    try {
      await post(`/platform/tenants/${t.id}/${approve ? 'approve' : 'reject'}`);
      notify(approve ? 'Organización activada' : 'Organización rechazada');
      await list.reload();
    } catch (e) {
      notify('No se pudo completar', errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen title="Organizaciones" onRefresh={list.reload} refreshing={list.loading}>
      <Muted>Las academias que se registran quedan pendientes hasta que las actives.</Muted>
      <Chips options={[{ value: 'pending' as const, label: 'Pendientes' }, { value: 'all' as const, label: 'Todas' }]} value={status} onChange={setStatus} />
      <Loader state={list}>
        {(rows) => rows.length === 0 ? <Empty text={status === 'pending' ? 'No hay organizaciones pendientes.' : 'No hay organizaciones.'} icon="business-outline" /> : rows.map((t) => (
          <Card key={t.id}>
            <InfoRow label={t.name} value={<Badge text={STATUS[t.status][0]} tone={STATUS[t.status][1]} />} />
            {t.admin ? <InfoRow label="Administrador" value={`${t.admin.full_name} (${t.admin.username})`} /> : null}
            {t.admin?.email || t.admin?.phone ? <InfoRow label="Contacto" value={[t.admin?.email, t.admin?.phone].filter(Boolean).join(' · ')} /> : null}
            <InfoRow label="Registro" value={fmtDateTime(t.created_at)} />
            <InfoRow label="Academias / clientes" value={`${t.academies} / ${t.clients}`} />
            <RowWrap style={{ marginTop: 8 }}>
              {t.status !== 'active' ? <Button small label="Activar" icon="checkmark" onPress={() => review(t, true)} loading={busy === t.id} /> : null}
              {t.status !== 'rejected' ? <Button small label={t.status === 'active' ? 'Suspender' : 'Rechazar'} variant="danger" onPress={() => review(t, false)} disabled={busy === t.id} /> : null}
            </RowWrap>
          </Card>
        ))}
      </Loader>
    </Screen>
  );
}
