import React, { useCallback, useEffect, useState } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Button, Card, ErrorBox, Loading, Muted, Screen, colors, errorText } from '../components/ui';
import { get } from '../lib/api';
import { useSession } from '../session';

/**
 * Codigo QR de ingreso del cliente (RQ7, RQ23). Es un token firmado que vence en 5 minutos y se renueva solo,
 * para que una captura de pantalla compartida no sirva para entrar despues.
 */
export default function MyQr() {
  const { user } = useSession();
  const [qr, setQr] = useState<{ token: string; expiresAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const size = Math.min(320, Dimensions.get('window').width - 90);

  const load = useCallback(async () => {
    try {
      const r = await get<{ token: string; expiresIn: number }>('/me/qr');
      setQr({ token: r.token, expiresAt: Date.now() + r.expiresIn * 1000 });
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Renueva 30 segundos antes de vencer
  useEffect(() => {
    if (qr && qr.expiresAt - now < 30_000) void load();
  }, [now, qr, load]);

  const left = qr ? Math.max(0, Math.round((qr.expiresAt - now) / 1000)) : 0;
  return (
    <Screen title="Mi código QR">
      <Card style={{ alignItems: 'center', paddingVertical: 24 }}>
        <Text style={s.name}>{user?.fullName}</Text>
        <Muted>Documento {user?.document}</Muted>
        <View style={s.qrBox}>
          {/* QR corto y con correccion baja: modulos grandes que la camara lee facil (RQ57); fondo blanco con margen */}
          {qr ? <QRCode value={qr.token} size={size} color="#000" backgroundColor="#fff" ecl="L" quietZone={12} /> : error ? null : <Loading />}
        </View>
        {qr ? <Muted>Se renueva automáticamente · {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</Muted> : null}
      </Card>
      {error ? <ErrorBox error={error} onRetry={load} /> : null}
      <Muted style={{ textAlign: 'center', marginVertical: 10 }}>
        Muestra este código en la recepción con el brillo de la pantalla alto. El personal elegirá la academia y la sede y se descontará la clase del plan correspondiente.
      </Muted>
      <Button label="Actualizar código" variant="secondary" icon="refresh" onPress={load} />
    </Screen>
  );
}

const s = StyleSheet.create({
  name: { fontSize: 20, fontWeight: '800', color: colors.text },
  qrBox: { padding: 16, backgroundColor: '#fff', borderRadius: 16, marginVertical: 18, minHeight: 280, minWidth: 280, alignItems: 'center', justifyContent: 'center' },
});
