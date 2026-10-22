import { router } from 'expo-router';
import React, { useState } from 'react';
import { CONSENT_TITLE, ConsentText } from '../components/shared';
import { Button, Card, Checkbox, Gap, H1, Screen, errorText, notify } from '../components/ui';
import { acceptConsent, useSession } from '../session';

/** Aceptacion del tratamiento de datos para cuentas creadas por el personal (RQ14) */
export default function Consent() {
  const { user, setUser, signOut } = useSession();
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    setBusy(true);
    try {
      setUser(await acceptConsent());
      router.replace('/home');
    } catch (e) {
      notify('No se pudo guardar', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Tratamiento de datos">
      <H1>{CONSENT_TITLE}</H1>
      <Gap h={6} />
      <Card>
        <ConsentText organization={user?.tenant.name} />
        <Checkbox checked={ok} onChange={setOk} testID="consent-check">
          Acepto el tratamiento de mis datos personales en los términos anteriores.
        </Checkbox>
      </Card>
      <Button label="Aceptar y continuar" onPress={accept} disabled={!ok} loading={busy} />
      <Gap />
      <Button label="No acepto, salir" variant="ghost" onPress={signOut} />
    </Screen>
  );
}
