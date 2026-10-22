import { router } from 'expo-router';
import React from 'react';
import { Badge, Button, Empty, ListItem, Loader, Screen, Section, useLoad } from '../../components/ui';
import { money, planKindLabel } from '../../lib/format';
import type { Plan } from '../../types';

/** Planes: numero de clases/asesorias, vigencia, academias y sedes permitidas (RQ7, RQ11, RQ12) */
export default function Plans() {
  const list = useLoad<Plan[]>('/plans');
  return (
    <Screen title="Planes" onRefresh={list.reload} refreshing={list.loading}>
      <Button label="Nuevo plan" icon="add" onPress={() => router.push('/plans/edit')} />
      <Section title="Planes">
        <Loader state={list}>
          {(rows) => rows.length === 0 ? <Empty text="Crea tu primer plan." /> : rows.map((p) => (
            <ListItem
              key={p.id}
              icon="pricetag-outline"
              title={`${p.name} · ${money(p.price)}`}
              muted={!p.active}
              subtitle={`${p.units == null ? 'Ilimitado' : `${p.units} clases/reservas`} · ${p.validity_days} días\n${p.academies.map((a) => a.name).join(', ')} · ${p.all_sites ? 'todas las sedes' : p.sites.map((s) => s.name).join(', ')}`}
              right={<Badge text={planKindLabel(p.kind)} />}
              onPress={() => router.push({ pathname: '/plans/edit', params: { id: String(p.id) } })}
            />
          ))}
        </Loader>
      </Section>
    </Screen>
  );
}
