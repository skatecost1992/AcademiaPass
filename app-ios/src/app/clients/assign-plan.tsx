import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Button, Card, Chips, Field, InfoRow, Loader, Muted, Screen, Section, Toggle, errorText, notify, useLoad } from '../../components/ui';
import { post } from '../../lib/api';
import { PAY_METHODS, cap, fmtDate, isDate, money, planEnd, planKindLabel, today, validityText } from '../../lib/format';
import { useSession } from '../../session';
import type { Plan } from '../../types';

/** Asignar un plan al cliente con su pago (RQ6, RQ7). El cliente queda asociado a las academias del plan (RQ13) */
export default function AssignPlan() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const { can } = useSession();
  const plans = useLoad<Plan[]>('/plans');
  const [planId, setPlanId] = useState<number | null>(null);
  const [startsOn, setStartsOn] = useState(today());
  const [withPayment, setWithPayment] = useState(can('payments'));
  const [pay, setPay] = useState({ amount: '', method: 'efectivo', reference: '' });
  const [busy, setBusy] = useState(false);
  const plan = plans.data?.find((p) => p.id === planId);

  const save = async () => {
    if (!isDate(startsOn)) return notify('Fecha inválida', 'Usa AAAA-MM-DD.');
    setBusy(true);
    try {
      await post('/memberships', {
        clientId: Number(clientId), planId, startsOn,
        payment: withPayment ? { amount: Number(pay.amount), method: pay.method, reference: pay.reference || null } : null,
      });
      notify('Plan asignado');
      router.back();
    } catch (e) {
      notify('No se pudo asignar', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Asignar plan">
      <Loader state={plans}>
        {(rows) => (
          <Chips label="Plan" options={rows.filter((p) => p.active && (!p.sale_until || p.sale_until >= today())).map((p) => ({ value: p.id, label: `${p.name} · ${money(p.price)}` }))} value={planId ?? undefined}
            onChange={(v) => { setPlanId(v); setPay((x) => ({ ...x, amount: String(rows.find((p) => p.id === v)?.price ?? '') })); }} />
        )}
      </Loader>
      {plan ? (
        <Card>
          <InfoRow label="Tipo" value={planKindLabel(plan.kind)} />
          <InfoRow label="Clases" value={plan.units == null ? 'Ilimitado' : String(plan.units)} />
          <InfoRow label="Vigencia" value={`${validityText(plan)}: ${fmtDate(startsOn)} – ${isDate(startsOn) ? fmtDate(planEnd(startsOn, plan)) : '…'}`} />
          <InfoRow label="Academias" value={plan.academies.map((a) => a.name).join(', ')} />
          <InfoRow label="Sedes" value={plan.all_sites ? 'Todas' : plan.sites.map((s) => s.name).join(', ')} />
        </Card>
      ) : null}
      <Field label="Fecha de ingreso (AAAA-MM-DD)" value={startsOn} onChangeText={setStartsOn} hint="La vigencia del plan se cuenta desde esta fecha." />
      {can('payments') ? (
        <Section title="Pago">
          <Toggle label="Registrar el pago ahora" value={withPayment} onChange={setWithPayment} />
          {withPayment ? (
            <Card>
              <Field label="Valor" value={pay.amount} onChangeText={(v) => setPay({ ...pay, amount: v.replace(/[^\d.]/g, '') })} keyboardType="decimal-pad" />
              <Chips label="Medio de pago" options={PAY_METHODS.map((m) => ({ value: m, label: cap(m) }))} value={pay.method} onChange={(v) => setPay({ ...pay, method: v })} />
              <Field label="Referencia (opcional)" value={pay.reference} onChangeText={(v) => setPay({ ...pay, reference: v })} />
            </Card>
          ) : <Muted>Podrás registrar el pago después desde la ficha del cliente.</Muted>}
        </Section>
      ) : null}
      <Button label="Asignar plan" onPress={save} loading={busy} disabled={!planId || (withPayment && !(Number(pay.amount) > 0))} style={{ marginTop: 12 }} />
    </Screen>
  );
}
