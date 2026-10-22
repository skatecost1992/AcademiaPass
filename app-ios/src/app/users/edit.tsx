import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Button, Card, Checkbox, Field, Loading, Muted, Screen, Section, Toggle, errorText, notify, useLoad } from '../../components/ui';
import { post, put } from '../../lib/api';
import type { Permission } from '../../types';
import type { StaffUser } from './index';

export default function UserEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const perms = useLoad<{ key: Permission; label: string }[]>('/permissions');
  const users = useLoad<StaffUser[]>(id ? '/users' : null);
  const [f, setF] = useState({ fullName: '', document: '', email: '', phone: '', username: '', password: '', active: true });
  const [selected, setSelected] = useState<Permission[]>(['attendance']);
  const [loaded, setLoaded] = useState(!id);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const u = users.data?.find((x) => x.id === Number(id));
    if (u && !loaded) {
      setF({ fullName: u.full_name, document: u.document, email: u.email ?? '', phone: u.phone ?? '', username: u.username, password: '', active: u.active });
      setSelected(u.permissions);
      setLoaded(true);
    }
  }, [users.data, id, loaded]);

  const toggle = (p: Permission) => setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));

  const save = async () => {
    setBusy(true);
    try {
      const common = { fullName: f.fullName, email: f.email || null, phone: f.phone || null, permissions: selected };
      if (id) await put(`/users/${id}`, { ...common, active: f.active, password: f.password || undefined });
      else await post('/users', { ...common, document: f.document, username: f.username.trim().toLowerCase(), password: f.password });
      router.back();
    } catch (e) {
      notify('No se pudo guardar', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <Screen title="Usuario"><Loading /></Screen>;
  return (
    <Screen title={id ? 'Editar usuario' : 'Nuevo usuario'}>
      <Card>
        <Field label="Nombre completo" value={f.fullName} onChangeText={(v) => setF({ ...f, fullName: v })} />
        <Field label="Documento" value={f.document} onChangeText={(v) => setF({ ...f, document: v })} editable={!id} autoCapitalize="characters" />
        <Field label="Correo" value={f.email} onChangeText={(v) => setF({ ...f, email: v })} autoCapitalize="none" keyboardType="email-address" />
        <Field label="Celular" value={f.phone} onChangeText={(v) => setF({ ...f, phone: v })} keyboardType="phone-pad" />
        <Field label="Usuario" value={f.username} onChangeText={(v) => setF({ ...f, username: v })} editable={!id} autoCapitalize="none" />
        <Field label={id ? 'Nueva contraseña (opcional)' : 'Contraseña'} value={f.password} onChangeText={(v) => setF({ ...f, password: v })} secureTextEntry autoCapitalize="none" hint="Mínimo 8 caracteres." />
        {id ? <Toggle label="Usuario activo" value={f.active} onChange={(v) => setF({ ...f, active: v })} /> : null}
      </Card>
      <Section title="Permisos">
        <Card>
          {(perms.data ?? []).map((p) => (
            <Checkbox key={p.key} checked={selected.includes(p.key)} onChange={() => toggle(p.key)}>
              {p.label}
            </Checkbox>
          ))}
          <Muted style={{ fontSize: 12, marginTop: 4 }}>"Permitir ingresos por fuera del aforo" solo debería tenerlo quien autoriza excepciones.</Muted>
        </Card>
      </Section>
      <Button label="Guardar" onPress={save} loading={busy} disabled={!f.fullName.trim() || (!id && (!f.username || f.password.length < 8 || !f.document))} />
    </Screen>
  );
}
