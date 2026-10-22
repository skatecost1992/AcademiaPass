import React, { useState } from 'react';
import { Badge, Button, Card, Field, Gap, Loader, Muted, Screen, Section, Toggle, colors, confirm, errorText, notify, useLoad } from '../components/ui';
import { Text } from 'react-native';
import { del, post, put } from '../lib/api';
import { useSession } from '../session';
import type { Academy } from '../types';

/** Academias de la organizacion (RQ12) con su codigo de inscripcion para clientes */
export default function Academies() {
  const { refresh } = useSession();
  const list = useLoad<Academy[]>('/academies');
  const [editing, setEditing] = useState<Partial<Academy> | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (regenerateCode = false) => {
    if (!editing) return;
    setBusy(true);
    try {
      const body = { name: editing.name ?? '', description: editing.description || null, active: editing.active ?? true, regenerateCode };
      if (editing.id) await put(`/academies/${editing.id}`, body);
      else await post('/academies', body);
      setEditing(null);
      await Promise.all([list.reload(), refresh()]);
    } catch (e) {
      notify('No se pudo guardar', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: Academy) => {
    if (!(await confirm('Eliminar academia', `Se eliminarán ${a.name}, sus sedes, espacios y clases. ¿Continuar?`, 'Eliminar'))) return;
    try {
      await del(`/academies/${a.id}`);
      setEditing(null);
      await Promise.all([list.reload(), refresh()]);
    } catch (e) {
      notify('No se pudo eliminar', errorText(e));
    }
  };

  return (
    <Screen title="Academias" onRefresh={list.reload} refreshing={list.loading}>
      <Muted>Cada academia tiene sus sedes, clases y un código para que los clientes se inscriban. Los planes indican a qué academias dan acceso.</Muted>
      <Gap />
      {editing ? (
        <Card>
          <Field label="Nombre" value={editing.name ?? ''} onChangeText={(v) => setEditing({ ...editing, name: v })} />
          <Field label="Descripción" value={editing.description ?? ''} onChangeText={(v) => setEditing({ ...editing, description: v })} multiline />
          {editing.id ? <Toggle label="Activa" value={editing.active ?? true} onChange={(v) => setEditing({ ...editing, active: v })} /> : null}
          <Button label="Guardar" onPress={() => save()} loading={busy} disabled={!editing.name?.trim()} />
          <Gap h={8} />
          {editing.id ? <Button label="Generar código nuevo" variant="secondary" icon="refresh" onPress={() => save(true)} disabled={busy} /> : null}
          {editing.id ? <Button label="Eliminar academia" variant="ghost" onPress={() => remove(editing as Academy)} /> : null}
          <Button label="Cancelar" variant="ghost" onPress={() => setEditing(null)} />
        </Card>
      ) : (
        <Button label="Nueva academia" icon="add" onPress={() => setEditing({ active: true })} />
      )}
      <Section title="Mis academias">
        <Loader state={list}>
          {(rows) => rows.map((a) => (
            <Card key={a.id}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>{a.name}</Text>
              {a.description ? <Muted>{a.description}</Muted> : null}
              <Gap h={6} />
              <Text style={{ color: colors.muted }}>Código de inscripción</Text>
              <Text selectable style={{ fontSize: 24, fontWeight: '800', letterSpacing: 3, color: colors.primary }}>{a.join_code}</Text>
              <Gap h={6} />
              <Badge text={`${a.sites} sede(s)${a.active ? '' : ' · inactiva'}`} tone={a.active ? 'primary' : 'muted'} />
              <Gap h={6} />
              <Button small label="Editar" variant="secondary" icon="create-outline" onPress={() => setEditing(a)} />
            </Card>
          ))}
        </Loader>
      </Section>
    </Screen>
  );
}
