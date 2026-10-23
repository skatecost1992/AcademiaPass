import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Button, Card, Chips, Field, InfoRow, Muted, Screen, Section, errorText, notify, useLoad } from '../../components/ui';
import { get, post, qs } from '../../lib/api';
import { PAY_METHODS, addDays, cap, fmtDate, fmtRange, money, today } from '../../lib/format';
import type { Booking, ClientRow, Membership } from '../../types';

/**
 * Registrar un pago: siempre a un cliente y a uno de sus planes adquiridos (RQ6, RQ34). Opcionalmente se asocia
 * a una reserva de espacio de ese mismo cliente. Llega con el plan o la reserva desde sus fichas, o se busca el
 * cliente.
 */
export default function NewPayment() {
  const params = useLocalSearchParams<{ membershipId?: string; bookingId?: string; clientId?: string }>();
  const [q, setQ] = useState('');
  const [client, setClient] = useState<{ id: number; full_name: string; document: string } | null>(null);
  const [membershipId, setMembershipId] = useState<number | null>(params.membershipId ? Number(params.membershipId) : null);
  const [bookingId, setBookingId] = useState<number | null>(params.bookingId ? Number(params.bookingId) : null);
  const [f, setF] = useState({ amount: '', method: 'efectivo', reference: '', notes: '' });
  const [busy, setBusy] = useState(false);

  // Desde una reserva o un cliente concreto: se fija el cliente
  const fromBooking = useLoad<Booking>(params.bookingId ? `/bookings/${params.bookingId}` : null);
  useEffect(() => {
    const id = params.clientId ? Number(params.clientId) : fromBooking.data?.client_id;
    if (id && !client) get<ClientRow>(`/clients/${id}`).then((c) => setClient({ id: c.id, full_name: c.full_name, document: c.document })).catch(() => {});
  }, [fromBooking.data, params.clientId, client]);

  const found = useLoad<ClientRow[]>(!client && q.trim().length >= 2 ? `/clients${qs({ q: q.trim() })}` : null);
  const detail = useLoad<{ memberships: Membership[] }>(client ? `/clients/${client.id}` : null);
  const rentals = useLoad<Booking[]>(client ? `/bookings${qs({ from: addDays(today(), -60), to: addDays(today(), 120), kind: 'rental' })}` : null);

  const memberships = (detail.data?.memberships ?? []).filter((m) => m.status === 'active');
  const clientRentals = (rentals.data ?? []).filter((b) => b.client_id === client?.id && b.status === 'confirmed');
  const plan = memberships.find((m) => m.id === membershipId);
  const bookingWithoutClient = !!fromBooking.data && !fromBooking.data.client_id;

  useEffect(() => {
    if (!membershipId && memberships.length === 1) setMembershipId(memberships[0].id);
  }, [memberships.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true);
    try {
      await post('/payments', {
        clientId: client!.id, membershipId, bookingId,
        amount: Number(f.amount), method: f.method, reference: f.reference || null, notes: f.notes || null,
      });
      notify('Pago registrado');
      router.back();
    } catch (e) {
      notify('No se pudo registrar', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (bookingWithoutClient) {
    return (
      <Screen title="Registrar pago">
        <Card>
          <Muted>
            Esta reserva no está a nombre de un cliente. Todo pago se registra a un cliente y a uno de sus planes:
            registra a quien paga como cliente, asígnale un plan y registra el pago desde su ficha.
          </Muted>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen title="Registrar pago">
      <Section title="1. Cliente">
        {client ? (
          <Card>
            <InfoRow label={client.full_name} value={`Doc. ${client.document}`} />
            {!params.bookingId && !params.clientId && !params.membershipId ? (
              <Button small variant="ghost" label="Cambiar cliente" onPress={() => { setClient(null); setMembershipId(null); setBookingId(null); }} />
            ) : null}
          </Card>
        ) : (
          <>
            <Field label="Buscar cliente" value={q} onChangeText={setQ} placeholder="Nombre o documento" />
            <Chips options={(found.data ?? []).slice(0, 10).map((c) => ({ value: c.id, label: `${c.full_name} · ${c.document}` }))}
              onChange={(v) => { const c = found.data!.find((x) => x.id === v)!; setClient({ id: c.id, full_name: c.full_name, document: c.document }); }} />
          </>
        )}
      </Section>

      {client ? (
        <Section title="2. Plan">
          {memberships.length ? (
            <Chips options={memberships.map((m) => ({ value: m.id, label: `${m.plan_name} · pagado ${money(m.paid)} de ${money(m.price)}` }))}
              value={membershipId ?? undefined} onChange={setMembershipId} />
          ) : <Muted>El cliente no tiene planes activos. Asígnale un plan desde su ficha antes de registrar el pago.</Muted>}
          {plan ? <Muted style={{ fontSize: 12 }}>Vigencia {fmtDate(plan.starts_on)} – {fmtDate(plan.ends_on)}</Muted> : null}
        </Section>
      ) : null}

      {client && clientRentals.length ? (
        <Section title="3. Reserva de espacio (opcional)">
          <Chips<number | null>
            options={[{ value: null, label: 'Ninguna' }, ...clientRentals.map((b) => ({ value: b.id as number | null, label: `${fmtRange(b.starts_at, b.ends_at)} · ${b.space_name}` }))]}
            value={bookingId} onChange={setBookingId} />
        </Section>
      ) : null}

      <Section title="Pago">
        <Card>
          <Field label="Valor" value={f.amount} onChangeText={(v) => setF({ ...f, amount: v.replace(/[^\d.]/g, '') })} keyboardType="decimal-pad" />
          <Chips label="Medio de pago" options={PAY_METHODS.map((m) => ({ value: m, label: cap(m) }))} value={f.method} onChange={(v) => setF({ ...f, method: v })} />
          <Field label="Referencia (opcional)" value={f.reference} onChangeText={(v) => setF({ ...f, reference: v })} />
          <Field label="Notas" value={f.notes} onChangeText={(v) => setF({ ...f, notes: v })} multiline />
          <Button label="Registrar pago" onPress={save} loading={busy} disabled={!client || !membershipId || !(Number(f.amount) > 0)} />
        </Card>
      </Section>
    </Screen>
  );
}
