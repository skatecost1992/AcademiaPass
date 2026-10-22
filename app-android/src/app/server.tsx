import { router } from 'expo-router';
import React, { useState } from 'react';
import { Button, Card, Field, Gap, Muted, Screen, errorText, notify } from '../components/ui';
import { getApiUrl, normalizeUrl, setApiUrl } from '../lib/api';

/** Direccion del servidor en la nube. Es la misma para todos los telefonos, asi todos ven los mismos datos (RQ24) */
export default function Server() {
  const [url, setUrl] = useState(getApiUrl());
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const u = normalizeUrl(url);
    setBusy(true);
    try {
      const res = await fetch(`${u}/api/health`);
      const body = await res.json();
      if (!body.ok) throw new Error('El servidor no respondió como AcademiaPass');
      await setApiUrl(u);
      notify('Servidor guardado', 'Conexión verificada.');
      router.back();
    } catch (e) {
      notify('No se pudo conectar', `${errorText(e)}\n\nVerifica la dirección (ej. https://academiapass.onrender.com).`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Servidor">
      <Card>
        <Muted>
          Todos los datos se guardan en la base de datos del servidor en la nube. Escribe la dirección pública del
          servidor de AcademiaPass para que este dispositivo vea la misma información que los demás.
        </Muted>
        <Gap />
        <Field label="Dirección del servidor" value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" placeholder="https://academiapass.onrender.com" />
        <Button label="Probar y guardar" onPress={save} loading={busy} disabled={!url.trim()} />
      </Card>
    </Screen>
  );
}
