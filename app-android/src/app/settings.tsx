import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Chips, Field, Gap, Loading, Muted, Screen, Section, colors, errorText, notify } from '../components/ui';
import { get, put } from '../lib/api';

interface Settings {
  cancelHours: number;
  bookingHorizonMonths: number;
  academies: { id: number; name: string; cancelHours: number | null }[];
  sites: { id: number; name: string; academyId: number; academyName: string; cancelHours: number | null }[];
}

const PRESETS = [
  { value: 0, label: 'Hasta que empiece' },
  { value: 2, label: '2 h antes' },
  { value: 6, label: '6 h antes' },
  { value: 12, label: '12 h antes' },
  { value: 24, label: '1 día antes' },
  { value: 48, label: '2 días antes' },
];

const label = (h: number) => (h === 0 ? 'hasta que empiece' : h % 24 === 0 ? `${h / 24} día(s) antes` : `${h} h antes`);

/** Selector de horas; con `inherit` permite "Usar la regla de arriba" (valor null) */
function HoursPicker({ value, onChange, inherit }: { value: number | null; onChange: (v: number | null) => void; inherit?: string }) {
  const [custom, setCustom] = useState(value != null && !PRESETS.some((p) => p.value === value) ? String(value) : '');
  return (
    <View>
      <Chips<number | null>
        options={[...(inherit ? [{ value: null as number | null, label: `Heredar (${inherit})` }] : []), ...PRESETS.map((p) => ({ value: p.value as number | null, label: p.label }))]}
        value={value != null && !PRESETS.some((p) => p.value === value) ? undefined : value}
        onChange={(v) => { setCustom(''); onChange(v); }}
      />
      <Field label="Otro (horas, 0 a 720)" value={custom} keyboardType="number-pad"
        onChangeText={(v) => { const d = v.replace(/\D/g, ''); setCustom(d); if (d !== '') onChange(Math.min(720, Number(d))); }} />
    </View>
  );
}

/**
 * Reglas de reserva (RQ32, RQ35): hasta cuando puede cancelar un cliente. Hay una regla general de la
 * organizacion y cada academia y cada sede pueden tener la suya (la sede manda sobre la academia).
 */
export default function SettingsScreen() {
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<Settings>('/settings').then(setS).catch((e) => notify('No se pudo cargar', errorText(e)));
  }, []);

  const save = async () => {
    if (!s) return;
    setBusy(true);
    try {
      await put('/settings', {
        cancelHours: s.cancelHours,
        bookingHorizonMonths: s.bookingHorizonMonths,
        academies: s.academies.map((a) => ({ id: a.id, cancelHours: a.cancelHours })),
        sites: s.sites.map((x) => ({ id: x.id, cancelHours: x.cancelHours })),
      });
      notify('Reglas guardadas');
      router.back();
    } catch (e) {
      notify('No se pudo guardar', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!s) return <Screen title="Reglas de reserva"><Loading /></Screen>;
  const academyRule = (academyId: number) => s.academies.find((a) => a.id === academyId)?.cancelHours ?? s.cancelHours;

  return (
    <Screen title="Reglas de reserva">
      <Muted>
        Hasta cuándo puede un cliente cancelar su cupo en una clase o su reserva de espacio. Después de ese límite
        solo el personal puede cancelar. La regla de la sede manda sobre la de la academia, y esta sobre la general.
      </Muted>

      <Section title="Hasta cuándo se puede reservar">
        <Card>
          <Muted style={{ marginBottom: 8 }}>Límite superior para reservar o agendar, contado desde hoy.</Muted>
          <Chips options={[1, 2, 3, 6, 12].map((m) => ({ value: m, label: m === 1 ? '1 mes' : `${m} meses` }))}
            value={s.bookingHorizonMonths} onChange={(v) => setS({ ...s, bookingHorizonMonths: v })} />
        </Card>
      </Section>

      <Section title="Regla general de la organización">
        <Card>
          <HoursPicker value={s.cancelHours} onChange={(v) => setS({ ...s, cancelHours: v ?? 24 })} />
        </Card>
      </Section>

      <Section title="Por academia">
        {s.academies.map((a) => (
          <Card key={a.id}>
            <Text style={{ fontWeight: '800', color: colors.text, marginBottom: 6 }}>{a.name}</Text>
            <HoursPicker value={a.cancelHours} inherit={label(s.cancelHours)}
              onChange={(v) => setS({ ...s, academies: s.academies.map((x) => (x.id === a.id ? { ...x, cancelHours: v } : x)) })} />
          </Card>
        ))}
      </Section>

      <Section title="Por sede">
        {s.sites.map((x) => (
          <Card key={x.id}>
            <Text style={{ fontWeight: '800', color: colors.text }}>{x.name}</Text>
            <Muted style={{ fontSize: 12, marginBottom: 6 }}>{x.academyName}</Muted>
            <HoursPicker value={x.cancelHours} inherit={label(academyRule(x.academyId))}
              onChange={(v) => setS({ ...s, sites: s.sites.map((y) => (y.id === x.id ? { ...y, cancelHours: v } : y)) })} />
          </Card>
        ))}
      </Section>

      <Gap />
      <Button label="Guardar reglas" onPress={save} loading={busy} />
      <Section title="Reglas que aplica el sistema">
        <Card>
          <Muted>• Solo se reservan clases programadas en la agenda y espacios activos con aforo definido.</Muted>
          <Muted>• El cliente necesita un plan vigente que incluya la academia y la sede: de clases para cupos en clases y de reservas para espacios.</Muted>
          <Muted>• Todo pago se registra a un cliente y a uno de sus planes; la reserva de espacio es opcional.</Muted>
        </Card>
      </Section>
    </Screen>
  );
}
