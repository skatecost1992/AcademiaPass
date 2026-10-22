import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Button, Card, Chips, Field, Loading, Muted, Screen, Section, Toggle, errorText, notify, useLoad } from '../../components/ui';
import { get, post, put } from '../../lib/api';
import type { Academy, ClientRow, Site } from '../../types';

/** Alta o edicion de un cliente por el personal. El cliente acepta el tratamiento de datos en su primer ingreso (RQ14) */
export default function ClientEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const academies = useLoad<Academy[]>('/academies');
  const sites = useLoad<Site[]>('/sites');
  const [f, setF] = useState({ fullName: '', document: '', email: '', phone: '', username: '', password: '', homeSiteId: null as number | null, active: true });
  const [academyIds, setAcademyIds] = useState<number[]>([]);
  const [loaded, setLoaded] = useState(!id);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    get<ClientRow>(`/clients/${id}`).then((c) => {
      setF({ fullName: c.full_name, document: c.document, email: c.email ?? '', phone: c.phone ?? '', username: c.username, password: '', homeSiteId: c.home_site_id, active: c.active });
      setAcademyIds(c.academies.map((a) => a.id));
      setLoaded(true);
    }).catch((e) => notify('No se pudo cargar', errorText(e)));
  }, [id]);
  useEffect(() => {
    if (!id && academyIds.length === 0 && academies.data?.length === 1) setAcademyIds([academies.data[0].id]);
  }, [academies.data, id, academyIds.length]);

  const save = async () => {
    setBusy(true);
    try {
      const common = { fullName: f.fullName, email: f.email || null, phone: f.phone || null, academyIds, homeSiteId: f.homeSiteId, active: f.active };
      if (id) {
        await put(`/clients/${id}`, { ...common, password: f.password || undefined });
        router.back();
      } else {
        const r = await post<{ id: number }>('/clients', { ...common, document: f.document, username: f.username.trim().toLowerCase(), password: f.password });
        router.replace({ pathname: '/clients/[id]', params: { id: String(r.id) } });
      }
    } catch (e) {
      notify('No se pudo guardar', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <Screen title="Cliente"><Loading /></Screen>;
  const siteOptions = (sites.data ?? []).filter((s) => academyIds.includes(s.academy_id));
  return (
    <Screen title={id ? 'Editar cliente' : 'Nuevo cliente'}>
      <Card>
        <Field label="Nombre completo" value={f.fullName} onChangeText={(v) => setF({ ...f, fullName: v })} />
        <Field label="Documento" value={f.document} onChangeText={(v) => setF({ ...f, document: v })} editable={!id} autoCapitalize="characters" />
        <Field label="Correo" value={f.email} onChangeText={(v) => setF({ ...f, email: v })} autoCapitalize="none" keyboardType="email-address" />
        <Field label="Celular" value={f.phone} onChangeText={(v) => setF({ ...f, phone: v })} keyboardType="phone-pad" />
      </Card>
      <Section title="Academias y sede">
        <Card>
          <Chips multi label="Academias" options={(academies.data ?? []).map((a) => ({ value: a.id, label: a.name }))} values={academyIds} onChangeMulti={setAcademyIds} />
          <Chips<number | null> label="Sede de inscripción" options={[{ value: null, label: 'Ninguna' }, ...siteOptions.map((s) => ({ value: s.id as number | null, label: s.name }))]} value={f.homeSiteId} onChange={(v) => setF({ ...f, homeSiteId: v })} />
        </Card>
      </Section>
      <Section title="Acceso a la app">
        <Card>
          <Field label="Usuario" value={f.username} onChangeText={(v) => setF({ ...f, username: v })} editable={!id} autoCapitalize="none" />
          <Field label={id ? 'Nueva contraseña (opcional)' : 'Contraseña inicial'} value={f.password} onChangeText={(v) => setF({ ...f, password: v })} secureTextEntry autoCapitalize="none" hint="Mínimo 8 caracteres. Entrégala al cliente para su primer ingreso." />
          {id ? <Toggle label="Cuenta activa" value={f.active} onChange={(v) => setF({ ...f, active: v })} /> : <Muted>Al ingresar por primera vez, el cliente deberá aceptar el tratamiento de datos.</Muted>}
        </Card>
      </Section>
      <Button label="Guardar" onPress={save} loading={busy} disabled={!f.fullName.trim() || academyIds.length === 0 || (!id && (!f.username || f.password.length < 8 || !f.document))} />
    </Screen>
  );
}
