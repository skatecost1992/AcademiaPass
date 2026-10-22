import { router } from 'expo-router';
import React, { useState } from 'react';
import { PhotoIcon } from '../../components/PhotoGallery';
import { PlacePicker } from '../../components/shared';
import { Badge, Button, Empty, Gap, ListItem, Loader, Muted, Screen, Section, useLoad } from '../../components/ui';
import { qs } from '../../lib/api';
import { DAYS } from '../../lib/format';
import type { Site } from '../../types';

/** Sedes por academia (RQ10) con su horario de atencion (RQ2) */
export default function Sites() {
  const [academyId, setAcademyId] = useState<number | null>(null);
  const list = useLoad<Site[]>(`/sites${qs({ academyId })}`);
  return (
    <Screen title="Sedes y espacios" onRefresh={list.reload} refreshing={list.loading}>
      <PlacePicker academyId={academyId} siteId={null} allowAll onChange={(a) => setAcademyId(a)} />
      <Button label="Nueva sede" icon="add" onPress={() => router.push({ pathname: '/sites/edit', params: academyId ? { academyId: String(academyId) } : {} })} />
      <Section title="Sedes">
        <Loader state={list}>
          {(rows) => rows.length === 0 ? <Empty text="No hay sedes." /> : rows.map((s) => (
            <ListItem
              key={s.id}
              icon="business-outline"
              title={s.name}
              muted={!s.active}
              subtitle={`${s.academy_name}${s.address ? ` · ${s.address}` : ''}\n${s.opening_hours.length ? s.opening_hours.map((h) => `${DAYS[h.day]} ${h.open}-${h.close}`).join(' · ') : 'Sin horario de atención (abierto siempre)'}`}
              right={s.active ? <PhotoIcon count={s.photos} /> : <Badge text="Inactiva" tone="muted" />}
              onPress={() => router.push({ pathname: '/sites/edit', params: { id: String(s.id) } })}
            />
          ))}
        </Loader>
      </Section>
      <Gap />
      <Muted style={{ fontSize: 12 }}>Abre una sede para editar su horario, sus fotos y sus espacios con aforo.</Muted>
    </Screen>
  );
}
