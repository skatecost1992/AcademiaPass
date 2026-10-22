import { router } from 'expo-router';
import React from 'react';
import { Badge, Button, Empty, ListItem, Loader, Muted, RowWrap, Screen, Section, useLoad } from '../../components/ui';
import type { ClassDef, Teacher } from '../../types';

/** Clases y profesores internos/externos (RQ3, RQ5) */
export default function Classes() {
  const classes = useLoad<ClassDef[]>('/classes');
  const teachers = useLoad<Teacher[]>('/teachers');
  return (
    <Screen title="Clases y profesores" onRefresh={() => { void classes.reload(); void teachers.reload(); }} refreshing={classes.loading}>
      <RowWrap>
        <Button label="Nueva clase" icon="add" onPress={() => router.push('/classes/edit')} />
        <Button label="Nuevo profesor" icon="person-add-outline" variant="secondary" onPress={() => router.push('/teachers/edit')} />
        <Button label="Programar horario" icon="calendar-outline" variant="secondary" onPress={() => router.push({ pathname: '/bookings/new', params: { kind: 'class' } })} />
      </RowWrap>
      <Section title="Clases">
        <Loader state={classes}>
          {(rows) => rows.length === 0 ? <Empty text="Aún no hay clases." /> : rows.map((c) => (
            <ListItem
              key={c.id}
              icon="school-outline"
              title={c.name}
              muted={!c.active}
              subtitle={`${c.academy_name} · cupo ${c.default_capacity}${c.teacher_name ? ` · ${c.teacher_name}${c.teacher_kind === 'external' ? ' (externo)' : ''}` : ' · sin profesor'}`}
              onPress={() => router.push({ pathname: '/classes/edit', params: { id: String(c.id) } })}
            />
          ))}
        </Loader>
        <Muted style={{ fontSize: 12 }}>Los horarios (fecha, hora desde y hasta, espacio) se programan en la Agenda.</Muted>
      </Section>
      <Section title="Profesores">
        <Loader state={teachers}>
          {(rows) => rows.length === 0 ? <Empty text="Aún no hay profesores." /> : rows.map((t) => (
            <ListItem
              key={t.id}
              icon="person-outline"
              title={t.full_name}
              muted={!t.active}
              subtitle={[t.specialty, t.phone].filter(Boolean).join(' · ') || null}
              right={<Badge text={t.kind === 'external' ? 'Externo' : 'Interno'} tone={t.kind === 'external' ? 'accent' : 'primary'} />}
              onPress={() => router.push({ pathname: '/teachers/edit', params: { id: String(t.id) } })}
            />
          ))}
        </Loader>
      </Section>
    </Screen>
  );
}
