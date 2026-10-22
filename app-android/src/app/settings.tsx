import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Button, Card, Chips, Field, Gap, Loading, Muted, Screen, Section, errorText, notify } from '../components/ui';
import { get, put } from '../lib/api';

const PRESETS = [
  { value: 0, label: 'Hasta que empiece' },
  { value: 2, label: '2 horas antes' },
  { value: 6, label: '6 horas antes' },
  { value: 12, label: '12 horas antes' },
  { value: 24, label: '1 día antes' },
  { value: 48, label: '2 días antes' },
];

/** Reglas de reserva de la organizacion (RQ32). Solo administrador */
export default function Settings() {
  const [hours, setHours] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<{ cancelHours: number }>('/settings')
      .then((s) => setHours(String(s.cancelHours)))
      .catch((e) => notify('No se pudo cargar', errorText(e)));
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      await put('/settings', { cancelHours: Number(hours) });
      notify('Reglas guardadas');
      router.back();
    } catch (e) {
      notify('No se pudo guardar', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (hours == null) return <Screen title="Reglas de reserva"><Loading /></Screen>;
  const n = Number(hours);
  return (
    <Screen title="Reglas de reserva">
      <Section title="Cancelación por parte del cliente">
        <Card>
          <Muted>
            Hasta cuántas horas antes del inicio un cliente puede cancelar su cupo en una clase o su reserva de espacio.
            Después de ese límite solo el personal puede cancelar.
          </Muted>
          <Gap />
          <Chips options={PRESETS} value={PRESETS.some((p) => p.value === n) ? n : undefined} onChange={(v) => setHours(String(v))} />
          <Field label="Horas antes (0 a 720)" value={hours} onChangeText={(v) => setHours(v.replace(/\D/g, ''))} keyboardType="number-pad" />
          <Button label="Guardar" onPress={save} loading={busy} disabled={hours === '' || n > 720} />
        </Card>
      </Section>
      <Section title="Reglas que aplica el sistema">
        <Card>
          <Muted>• Solo se reservan clases programadas en la agenda y espacios activos con aforo definido.</Muted>
          <Muted>• El cliente necesita un plan vigente que incluya la academia y la sede: de clases para reservar cupos en clases y de reservas para reservar espacios.</Muted>
          <Muted>• No se reserva por encima del cupo de la clase ni del aforo del espacio.</Muted>
        </Card>
      </Section>
    </Screen>
  );
}
