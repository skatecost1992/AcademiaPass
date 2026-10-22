import { router } from 'expo-router';
import React, { useState } from 'react';
import { PlacePicker } from '../../components/shared';
import { Badge, Button, Empty, Field, Loader, Muted, Screen, Section, useLoad } from '../../components/ui';
import { ListItem } from '../../components/ui';
import { qs } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { useSession } from '../../session';
import type { ClientRow } from '../../types';

/** Clientes de la organizacion, filtrables por academia y sede (RQ9, RQ10) */
export default function Clients() {
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [academyId, setAcademyId] = useState<number | null>(null);
  const [siteId, setSiteId] = useState<number | null>(null);
  const list = useLoad<ClientRow[]>(`/clients${qs({ q: q.trim(), academyId, siteId })}`);
  return (
    <Screen title="Clientes" onRefresh={list.reload} refreshing={list.loading}>
      {can('clients') ? <Button label="Nuevo cliente" icon="person-add-outline" onPress={() => router.push('/clients/edit')} /> : null}
      <Field label="Buscar" value={q} onChangeText={setQ} placeholder="Nombre, documento o usuario" autoCapitalize="none" style={{ marginTop: 12 }} />
      <PlacePicker academyId={academyId} siteId={siteId} allowAll onChange={(a, s) => { setAcademyId(a); setSiteId(s); }} />
      <Section title={`Clientes${list.data ? ` (${list.data.length})` : ''}`}>
        <Loader state={list}>
          {(rows) => rows.length === 0 ? <Empty text="No hay clientes con esos filtros." icon="people-outline" /> : rows.map((c) => (
            <ListItem
              key={c.id}
              icon="person-outline"
              title={c.full_name}
              muted={!c.active}
              subtitle={`Doc. ${c.document} · ${c.academies.map((a) => a.name).join(', ')}${c.home_site_name ? ` · ${c.home_site_name}` : ''}\nÚltimo ingreso: ${fmtDate(c.last_attendance)}`}
              right={!c.consent_at ? <Badge text="Sin aceptar datos" tone="accent" /> : undefined}
              onPress={() => router.push({ pathname: '/clients/[id]', params: { id: String(c.id) } })}
            />
          ))}
        </Loader>
      </Section>
      <Muted style={{ fontSize: 12 }}>El filtro de sede incluye clientes inscritos en ella o que han asistido a ella.</Muted>
    </Screen>
  );
}
