import { router } from 'expo-router';
import React, { useState } from 'react';
import { RangePicker, useRange } from '../../components/ReportParts';
import { PlacePicker } from '../../components/shared';
import { Button, Empty, Kpi, KpiRow, ListItem, Loader, Screen, Section, useLoad } from '../../components/ui';
import { qs } from '../../lib/api';
import { cap, fmtDateTime, money } from '../../lib/format';

interface PaymentRow { id: number; amount: number; method: string; reference: string | null; paid_at: string; payer: string | null; client_id: number | null; concept: string }

/** Pagos de planes y reservas (RQ4, RQ6) */
export default function Payments() {
  const range = useRange(30);
  const [academyId, setAcademyId] = useState<number | null>(null);
  const [siteId, setSiteId] = useState<number | null>(null);
  const list = useLoad<PaymentRow[]>(`/payments${qs({ from: range.from, to: range.to, academyId, siteId })}`);
  const total = (list.data ?? []).reduce((s, p) => s + p.amount, 0);
  return (
    <Screen title="Pagos" onRefresh={list.reload} refreshing={list.loading}>
      <Button label="Registrar pago" icon="add" onPress={() => router.push('/payments/new')} />
      <RangePicker range={range} showGroup={false} />
      <PlacePicker academyId={academyId} siteId={siteId} allowAll onChange={(a, s) => { setAcademyId(a); setSiteId(s); }} />
      <KpiRow>
        <Kpi label="Total recaudado" value={money(total)} icon="cash" tone="success" />
        <Kpi label="Pagos" value={list.data?.length ?? 0} icon="receipt" />
      </KpiRow>
      <Section title="Pagos">
        <Loader state={list}>
          {(rows) => rows.length === 0 ? <Empty text="Sin pagos en el periodo." icon="cash-outline" /> : rows.map((p) => (
            <ListItem
              key={p.id}
              icon="cash-outline"
              title={`${money(p.amount)} · ${p.payer ?? '—'}`}
              subtitle={`${p.concept} · ${cap(p.method)}${p.reference ? ` · ${p.reference}` : ''}\n${fmtDateTime(p.paid_at)}`}
              onPress={p.client_id ? () => router.push({ pathname: '/clients/[id]', params: { id: String(p.client_id) } }) : undefined}
            />
          ))}
        </Loader>
      </Section>
    </Screen>
  );
}
