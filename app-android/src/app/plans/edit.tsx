import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Button, Card, Chips, Field, Loading, Muted, Screen, Section, Toggle, errorText, notify, useLoad } from '../../components/ui';
import { post, put } from '../../lib/api';
import { Calendar } from '../../components/Calendar';
import { PLAN_KINDS, addDays, today } from '../../lib/format';
import type { Academy, Plan, PlanKind, Site } from '../../types';

export default function PlanEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const academies = useLoad<Academy[]>('/academies');
  const sites = useLoad<Site[]>('/sites');
  const plans = useLoad<Plan[]>(id ? '/plans' : null);
  const [f, setF] = useState({ name: '', description: '', kind: 'classes' as PlanKind, unlimited: false, units: '8', validityUnit: 'days' as 'days' | 'months', validity: '30', saleUntil: '', price: '', allSites: true, active: true });
  const [academyIds, setAcademyIds] = useState<number[]>([]);
  const [siteIds, setSiteIds] = useState<number[]>([]);
  const [loaded, setLoaded] = useState(!id);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const p = plans.data?.find((x) => x.id === Number(id));
    if (p && !loaded) {
      setF({ name: p.name, description: p.description ?? '', kind: p.kind, unlimited: p.units == null, units: String(p.units ?? 8), validityUnit: p.validity_months ? 'months' : 'days', validity: String(p.validity_months ?? p.validity_days), saleUntil: p.sale_until ?? '', price: String(p.price), allSites: p.all_sites, active: p.active });
      setAcademyIds(p.academies.map((a) => a.id));
      setSiteIds(p.sites.map((s) => s.id));
      setLoaded(true);
    }
  }, [plans.data, id, loaded]);

  const availableSites = (sites.data ?? []).filter((s) => academyIds.includes(s.academy_id));

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        name: f.name, description: f.description || null, kind: f.kind, units: f.unlimited ? null : Number(f.units),
        ...(f.validityUnit === 'months' ? { validityMonths: Number(f.validity) } : { validityDays: Number(f.validity) }),
        saleUntil: f.saleUntil || null,
        price: Number(f.price || 0), academyIds, allSites: f.allSites, siteIds: siteIds.filter((sid) => availableSites.some((s) => s.id === sid)), active: f.active,
      };
      if (id) await put(`/plans/${id}`, body);
      else await post('/plans', body);
      router.back();
    } catch (e) {
      notify('No se pudo guardar', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <Screen title="Plan"><Loading /></Screen>;
  return (
    <Screen title={id ? 'Editar plan' : 'Nuevo plan'}>
      <Card>
        <Field label="Nombre" value={f.name} onChangeText={(v) => setF({ ...f, name: v })} placeholder="Ej. Mensual 12 clases" />
        <Field label="Descripción" value={f.description} onChangeText={(v) => setF({ ...f, description: v })} multiline />
        <Chips label="Tipo de plan" options={PLAN_KINDS} value={f.kind} onChange={(v) => setF({ ...f, kind: v })}
          hint="Clases: ingresos a clases. Reservas: uso de espacios reservados. Acceso/asesorías: ingreso general. Mixto: todo." />
        <Toggle label="Ilimitado" value={f.unlimited} onChange={(v) => setF({ ...f, unlimited: v })} hint="Sin límite de clases durante la vigencia." />
        {!f.unlimited ? <Field label="Número de clases, asesorías o reservas" value={f.units} onChangeText={(v) => setF({ ...f, units: v })} keyboardType="number-pad" /> : null}
        {/* RQ55: vigencia en dias (hasta 365) o meses (hasta 12), contada desde la fecha de ingreso al asignar el plan */}
        <Chips label="Vigencia en" options={[{ value: 'days' as const, label: 'Días' }, { value: 'months' as const, label: 'Meses' }]} value={f.validityUnit}
          onChange={(v) => setF({ ...f, validityUnit: v, validity: v === 'months' ? '1' : '30' })} />
        <Field label={f.validityUnit === 'months' ? 'Número de meses (1 a 12)' : 'Número de días (1 a 365)'} value={f.validity}
          onChangeText={(v) => setF({ ...f, validity: v.replace(/\D/g, '') })} keyboardType="number-pad"
          error={Number(f.validity) > (f.validityUnit === 'months' ? 12 : 365) ? `Máximo ${f.validityUnit === 'months' ? '12 meses' : '365 días'}` : null}
          hint="Se cuenta desde la fecha de ingreso que se registre al asignar el plan al cliente." />
        {/* RQ56: despues de esta fecha no se vende a clientes nuevos */}
        <Toggle label="Fecha límite para adquirirlo" value={!!f.saleUntil} onChange={(v) => setF({ ...f, saleUntil: v ? addDays(today(), 30) : '' })}
          hint="Pasada esa fecha no se asigna a clientes nuevos; quienes ya lo tienen lo usan hasta su vencimiento." />
        {f.saleUntil ? (
          <>
            <Muted style={{ marginBottom: 6 }}>Se puede adquirir hasta el {f.saleUntil}</Muted>
            <Calendar value={f.saleUntil} onChange={(d) => setF({ ...f, saleUntil: d })} />
          </>
        ) : null}
        <Field label="Precio" value={f.price} onChangeText={(v) => setF({ ...f, price: v.replace(/[^\d.]/g, '') })} keyboardType="decimal-pad" />
      </Card>
      <Section title="Academias y sedes a las que da acceso">
        <Card>
          <Chips multi label="Academias a las que da acceso" options={(academies.data ?? []).map((a) => ({ value: a.id, label: a.name }))} values={academyIds} onChangeMulti={setAcademyIds}
            hint="Si eliges varias academias, el cliente puede ingresar a cualquiera de ellas con este plan." />
          <Toggle label="Todas las sedes de esas academias" value={f.allSites} onChange={(v) => setF({ ...f, allSites: v })} />
          {!f.allSites ? (
            availableSites.length ? (
              <Chips multi label="Sedes permitidas" options={availableSites.map((s) => ({ value: s.id, label: `${s.name} (${s.academy_name})` }))} values={siteIds} onChangeMulti={setSiteIds} />
            ) : <Muted>Selecciona primero las academias.</Muted>
          ) : null}
        </Card>
      </Section>
      <Toggle label="Plan activo (se puede vender)" value={f.active} onChange={(v) => setF({ ...f, active: v })} />
      <Button label="Guardar plan" onPress={save} loading={busy} disabled={!f.name.trim() || academyIds.length === 0} />
    </Screen>
  );
}
