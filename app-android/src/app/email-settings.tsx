import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Chips, Empty, Field, ListItem, Loader, Muted, RowWrap, Screen, Section, Toggle, colors, errorText, notify, useLoad } from '../components/ui';
import { post, put } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import type { OrgNotificationSettings } from '../types';

interface SentMail { id: number; kind: string; email: string; subject: string; status: 'pending' | 'sent' | 'logged' | 'failed'; error: string | null; created_at: string; full_name: string }

const KIND: Record<string, string> = { day_before: '1 día antes', hours_before: '3 horas antes', plan_expiring: 'Plan por vencer', plan_expired: 'Plan vencido' };
const STATUS: Record<SentMail['status'], { text: string; tone: 'success' | 'muted' | 'danger' }> = {
  sent: { text: 'Enviado', tone: 'success' },
  logged: { text: 'Sin SMTP', tone: 'muted' },
  pending: { text: 'Enviando', tone: 'muted' },
  failed: { text: 'Falló', tone: 'danger' },
};

/**
 * Correos automaticos de la organizacion (RQ63, RQ64): recordatorios de reservas y clases, y aviso de vencimiento
 * del plan. Cada usuario puede ademas apagar los suyos en Mi perfil.
 */
export default function EmailSettings() {
  const settings = useLoad<OrgNotificationSettings>('/notification-settings');
  const log = useLoad<SentMail[]>('/notifications');
  const [f, setF] = useState<OrgNotificationSettings | null>(null);
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'run' | null>(null);

  useEffect(() => {
    if (settings.data) { setF(settings.data); setDays(String(settings.data.planNoticeDays)); }
  }, [settings.data]);

  const run = async (kind: 'save' | 'test' | 'run') => {
    if (!f) return;
    setBusy(kind);
    try {
      if (kind === 'save') {
        setF(await put<OrgNotificationSettings>('/notification-settings', { dayBefore: f.dayBefore, hoursBefore: f.hoursBefore, plan: f.plan, planNoticeDays: Number(days) }));
        notify('Configuración guardada');
      } else if (kind === 'test') {
        const r = await post<{ email: string }>('/notifications/test', {});
        notify('Correo de prueba enviado', `Revisa la bandeja de ${r.email}.`);
      } else {
        const r = await post<{ reminders: number; plans: number }>('/notifications/run', {});
        notify('Avisos procesados', `${r.reminders} recordatorio(s) y ${r.plans} aviso(s) de plan.`);
        void log.reload();
      }
    } catch (e) {
      notify('No se pudo completar', errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const daysOk = /^\d+$/.test(days) && Number(days) <= 30;
  return (
    <Screen title="Correos automáticos" onRefresh={() => { void settings.reload(); void log.reload(); }} refreshing={log.loading}>
      {!f ? <Loader state={settings}>{() => null}</Loader> : (
        <>
          {!f.mailConfigured ? (
            <Card style={{ backgroundColor: colors.dangerSoft }}>
              <Muted style={{ color: colors.danger }}>
                El servidor no tiene configurado el envío de correos (SMTP). Los avisos quedan registrados pero no salen.
                Configura SMTP_HOST, SMTP_USER, SMTP_PASS y MAIL_FROM en el servidor.
              </Muted>
            </Card>
          ) : null}
          <Section title="Recordatorios de reservas y clases">
            <Card>
              <Toggle label={`${f.dayBeforeHours} horas antes`} value={f.dayBefore} onChange={(v) => setF({ ...f, dayBefore: v })} hint="Un día antes de cada reserva de espacio o cupo en clase." />
              <Toggle label={`${f.hoursBeforeHours} horas antes`} value={f.hoursBefore} onChange={(v) => setF({ ...f, hoursBefore: v })} />
              <Muted style={{ fontSize: 12 }}>Solo se recuerda lo que se reservó antes de ese momento.</Muted>
            </Card>
          </Section>
          <Section title="Vencimiento del plan">
            <Card>
              <Toggle label="Avisar el vencimiento" value={f.plan} onChange={(v) => setF({ ...f, plan: v })}
                hint="Con los datos del plan, las clases tomadas y las pendientes. También avisa cuando ya venció." />
              {f.plan ? (
                <>
                  <Chips label="Avisar con anticipación" options={[1, 3, 5, 7].map((d) => ({ value: d, label: `${d} día(s)` }))}
                    value={Number(days)} onChange={(v) => setDays(String(v))} />
                  <Field label="Días antes (0 a 30)" value={days} onChangeText={(v) => setDays(v.replace(/\D/g, ''))} keyboardType="number-pad"
                    error={daysOk ? null : 'Entre 0 y 30'} hint="0 = el mismo día del vencimiento." />
                </>
              ) : null}
            </Card>
          </Section>
          <Button label="Guardar" onPress={() => run('save')} loading={busy === 'save'} disabled={!daysOk} />
          <RowWrap style={{ marginTop: 8 }}>
            <Button label="Enviarme un correo de prueba" icon="mail-outline" variant="secondary" small onPress={() => run('test')} loading={busy === 'test'} />
            <Button label="Enviar pendientes ahora" icon="send-outline" variant="ghost" small onPress={() => run('run')} loading={busy === 'run'} />
          </RowWrap>
        </>
      )}
      <Section title="Últimos correos">
        <Loader state={log}>
          {(rows) => rows.length === 0 ? <Empty text="Aún no se han enviado correos." icon="mail-outline" /> : rows.map((n) => (
            <ListItem
              key={n.id}
              icon="mail-outline"
              title={n.subject}
              subtitle={`${n.full_name} · ${KIND[n.kind] ?? n.kind} · ${fmtDateTime(n.created_at)}${n.error ? `\n${n.error}` : ''}`}
              right={<Badge text={STATUS[n.status].text} tone={STATUS[n.status].tone} />}
            />
          ))}
        </Loader>
      </Section>
    </Screen>
  );
}
