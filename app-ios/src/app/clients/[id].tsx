import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';
import { Badge, Button, Card, Empty, InfoRow, Loader, Muted, RowWrap, Screen, Section, colors, confirm, errorText, notify, useLoad } from '../../components/ui';
import { post } from '../../lib/api';
import { cap, fmtDate, fmtDateTime, money, planKindLabel, unitsText } from '../../lib/format';
import { useSession } from '../../session';
import type { ClientRow, Membership } from '../../types';

interface Detail extends ClientRow {
  memberships: Membership[];
  payments: { id: number; amount: number; method: string; reference: string | null; paid_at: string; concept: string; membership_id: number | null }[];
  attendances: { id: number; scanned_at: string; over_capacity: boolean; academy_name: string; site_name: string; booking_title: string | null }[];
}

/** Ficha del cliente: planes y saldo, pagos y asistencias (RQ4, RQ6, RQ9) */
export default function ClientDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useSession();
  const d = useLoad<Detail>(`/clients/${id}`);

  const cancelMembership = async (m: Membership) => {
    if (!(await confirm('Cancelar plan', `¿Cancelar ${m.plan_name}? Ya no se podrá usar para ingresar.`, 'Cancelar plan'))) return;
    try {
      await post(`/memberships/${m.id}/cancel`);
      await d.reload();
    } catch (e) {
      notify('No se pudo cancelar', errorText(e));
    }
  };

  return (
    <Screen title="Cliente" onRefresh={d.reload} refreshing={d.loading}>
      <Loader state={d}>
        {(c) => (
          <>
            <Card>
              <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>{c.full_name}</Text>
              <InfoRow label="Documento" value={c.document} />
              <InfoRow label="Usuario" value={c.username} />
              {c.email ? <InfoRow label="Correo" value={c.email} /> : null}
              {c.phone ? <InfoRow label="Celular" value={c.phone} /> : null}
              <InfoRow label="Academias" value={c.academies.map((a) => a.name).join(', ')} />
              {c.home_site_name ? <InfoRow label="Sede" value={c.home_site_name} /> : null}
              <InfoRow label="Tratamiento de datos" value={c.consent_at ? <Badge text={`Aceptado ${fmtDate(c.consent_at)}`} tone="success" /> : <Badge text="Pendiente" tone="accent" />} />
              {!c.active ? <Badge text="Cuenta inactiva" tone="danger" /> : null}
            </Card>
            <RowWrap>
              {can('clients') ? <Button small label="Asignar plan" icon="pricetag-outline" onPress={() => router.push({ pathname: '/clients/assign-plan', params: { clientId: id } })} /> : null}
              {can('reports') ? <Button small label="Reporte unificado" icon="stats-chart-outline" variant="secondary" onPress={() => router.push({ pathname: '/clients/report', params: { clientId: id } })} /> : null}
              {can('clients') ? <Button small label="Editar" icon="create-outline" variant="secondary" onPress={() => router.push({ pathname: '/clients/edit', params: { id } })} /> : null}
            </RowWrap>

            <Section title="Planes">
              {c.memberships.length === 0 ? <Empty text="Sin planes adquiridos." icon="pricetag-outline" /> : c.memberships.map((m) => (
                <Card key={m.id}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text, flex: 1 }}>{m.plan_name}</Text>
                    <Badge text={m.status === 'cancelled' ? 'Cancelado' : m.is_current ? 'Vigente' : 'Terminado'} tone={m.is_current ? 'success' : 'muted'} />
                  </View>
                  <InfoRow label="Tipo" value={planKindLabel(m.kind)} />
                  <InfoRow label="Restantes" value={unitsText(m.remaining, m.units_total)} />
                  <InfoRow label="Vigencia" value={`${fmtDate(m.starts_on)} – ${fmtDate(m.ends_on)}`} />
                  <InfoRow label="Pagado" value={`${money(m.paid)} de ${money(m.price)}`} />
                  <Muted style={{ fontSize: 12 }}>{m.academies.map((a) => a.name).join(', ')} · {m.all_sites ? 'todas las sedes' : m.sites.map((s) => s.name).join(', ')}</Muted>
                  {m.status === 'active' ? (
                    <RowWrap style={{ marginTop: 8 }}>
                      {can('payments') && m.paid < m.price ? <Button small label="Registrar pago" icon="cash-outline" onPress={() => router.push({ pathname: '/payments/new', params: { membershipId: String(m.id) } })} /> : null}
                      {can('clients') ? <Button small label="Cancelar plan" variant="ghost" onPress={() => cancelMembership(m)} /> : null}
                    </RowWrap>
                  ) : null}
                </Card>
              ))}
            </Section>

            <Section title="Pagos">
              {c.payments.length === 0 ? <Empty text="Sin pagos." icon="cash-outline" /> : (
                <Card>{c.payments.map((p) => <InfoRow key={p.id} label={`${fmtDate(p.paid_at)} · ${p.concept} · ${cap(p.method)}`} value={money(p.amount)} />)}</Card>
              )}
            </Section>

            <Section title="Últimas asistencias">
              {c.attendances.length === 0 ? <Empty text="Sin asistencias." icon="calendar-outline" /> : (
                <Card>
                  {c.attendances.map((a) => (
                    <InfoRow key={a.id} label={fmtDateTime(a.scanned_at)} value={`${a.academy_name} · ${a.site_name}${a.booking_title ? ` · ${a.booking_title}` : ''}${a.over_capacity ? ' · fuera de aforo' : ''}`} />
                  ))}
                </Card>
              )}
            </Section>
          </>
        )}
      </Loader>
    </Screen>
  );
}
