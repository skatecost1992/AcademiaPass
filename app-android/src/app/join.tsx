import { router } from 'expo-router';
import React, { useState } from 'react';
import { Button, Card, Field, Gap, Muted, Screen, errorText, notify } from '../components/ui';
import { ApiError, post } from '../lib/api';
import { useSession } from '../session';
import type { Profile } from '../types';

/** El cliente se asocia a otra academia de la misma organizacion (RQ13) */
export default function Join() {
  const { setUser } = useSession();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      setUser(await post<Profile>('/me/academies', { joinCode: code }));
      notify('Listo', 'Quedaste asociado a la academia.');
      router.back();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OTHER_TENANT') {
        notify('Academia de otra organización', 'Para inscribirte allí crea una cuenta nueva desde "Crear cuenta de cliente" con tu mismo documento. Tus datos de cada organización se mantienen separados.');
      } else {
        notify('No se pudo asociar', errorText(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Unirme a otra academia">
      <Card>
        <Muted>Escribe el código que te entregó la academia. También quedas asociado automáticamente cuando adquieres un plan que la incluye.</Muted>
        <Gap />
        <Field label="Código de la academia" value={code} onChangeText={setCode} autoCapitalize="characters" />
        <Button label="Unirme" onPress={submit} loading={busy} disabled={code.trim().length < 4} />
      </Card>
    </Screen>
  );
}
