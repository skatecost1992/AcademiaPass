import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Button, Card, Chips, Field, InfoRow, Muted, Screen, Section, errorText, notify, useLoad } from '../../components/ui';
import { post, qs } from '../../lib/api';
import { PAY_METHODS, addDays, cap, fmtDate, fmtRange, money, today } from '../../lib/format';
import type { Booking, ClientRow, Membership } from '../../types';

/**
 * Registrar un pago. Todo pago se asocia a un plan adquirido o a una reserva (RQ6): llega con el id desde la ficha
 * del cliente o de la reserva, o se busca el cliente y se elige a que corresponde.
 */
export default function NewPayment() {
  const params = useLocalSearchParams<{ membershipId?: string; bookingId?: string }>();
  const [q, setQ] = useState('');
  const [client, setClient] = useState<ClientRow | null>(null);
  const [target, setTarget] = useState<string | null>(params.membershipId ? `m${params.membershipId}` : params.bookingId ? `b${params.bookingId}` : null);
  const [f, setF] = useState({ amount: '', method: 'efectivo', reference: '', notes: '', payerName: '' });
  const [busy, setBusy] = useState(false);
  const fixed = !!(params.membershipId || params.bookingId);

  const clients = useLoad<ClientRow[]>(!fixed && q.trim().length >= 2 && !client ? `/clients${qs({ q: q.trim() })}` : null);
  const detail = useLoad<{ memberships: Membership[] }>(client ? `/clients/${client.id}` : null);
  const bookings = useLoad<Booking[]>(client ? `/bookings${qs({ from: addDays(today(), -60), to: addDays(today(), 120), kind: 'rental' })}` : null);
  const booking = useLoad<Booking>(params.bookingId ? `/bookings/${params.bookingId}` : null);

  const options = [
    ...(detail.data?.memberships ?? []).filter((m) => m.status === 'active').map((m) => ({ value: `m${m.id}`, label: `Plan ${m.plan_name} (pagado ${money(m.paid)} de ${money(m.price)})` })),
    ...(bookings.data ?? []).filter((b) => b.client_id === client?.id && b.status === 'confirmed').map((b) => ({ value: `b${b.id}`, label: `Reserva ${fmtDate(b.starts_at)} ${b.space_name}` })),
  ];
  const needsPayer = !!booking.data && !booking.data.client_id;

  const save = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await post('/payments', {
        amount: Number(f.amount), method: f.method, reference: f.reference || null, notes: f.notes || null,
        ...(target.startsWith('m') ? { membershipId: Number(target.slice(1)) } : { bookingId: Number(target.slice(1)) }),
        ...(needsPayer ? { payerName: f.payerName } : {}),
      });
      notify('Pago registrado');
      router.back();
    } catch (e) {
      notify('No se pudo registrar', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Registrar pago">
      {!fixed ? (
        <Section title="Cliente">
          {client ? (
            <Card>
              <InfoRow label={client.full_name} value={`Doc. ${client.document}`} />
              <Button small variant="ghost" label="Cambiar cliente" onPress={() => { setClient(null); setTarget(null); }} />
            </Card>
          ) : (
            <>
              <Field label="Buscar cliente" value={q} onChangeText={setQ} placeholder="Nombre o documento" />
              <Chips options={(clients.data ?? []).slice(0, 10).map((c) => ({ value: c.id, label: `${c.full_name} · ${c.document}` }))} onChange={(v) => setClient(clients.data!.find((c) => c.id === v)!)} />
            </>
          )}
          {client ? (
            options.length ? <Chips label="Concepto" options={options} value={target ?? undefined} onChange={setTarget} />
              : <Muted>El cliente no tiene planes activos ni reservas. Asígnale un plan desde su ficha.</Muted>
          ) : null}
        </Section>
      ) : booking.data ? (
        <Card><InfoRow label="Reserva" value={`${booking.data.title} · ${fmtRange(booking.data.starts_at, booking.data.ends_at)}`} /></Card>
      ) : <Muted>Pago del plan seleccionado.</Muted>}

      <Section title="Pago">
        <Card>
          <Field label="Valor" value={f.amount} onChangeText={(v) => setF({ ...f, amount: v.replace(/[^\d.]/g, '') })} keyboardType="decimal-pad" />
          <Chips label="Medio de pago" options={PAY_METHODS.map((m) => ({ value: m, label: cap(m) }))} value={f.method} onChange={(v) => setF({ ...f, method: v })} />
          <Field label="Referencia (opcional)" value={f.reference} onChangeText={(v) => setF({ ...f, reference: v })} />
          {needsPayer ? <Field label="Quién paga" value={f.payerName} onChangeText={(v) => setF({ ...f, payerName: v })} placeholder="Ej. profesor externo" /> : null}
          <Field label="Notas" value={f.notes} onChangeText={(v) => setF({ ...f, notes: v })} multiline />
          <Button label="Registrar pago" onPress={save} loading={busy} disabled={!target || !(Number(f.amount) > 0) || (needsPayer && !f.payerName.trim())} />
        </Card>
      </Section>
    </Screen>
  );
}
