/**
 * Piezas compartidas: texto de tratamiento de datos (RQ14) y selector de academia/sede (RQ10).
 */
import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { qs, serverLabel } from '../lib/api';
import type { Academy, Site } from '../types';
import { Chips, colors, useLoad } from './ui';

/** Indica en que servidor quedara el registro, con acceso para cambiarlo */
export function ServerNotice() {
  return (
    <View style={{ backgroundColor: colors.primarySoft, borderRadius: 10, padding: 10, marginBottom: 12 }}>
      <Text style={{ color: colors.text, fontSize: 13 }}>
        Te registrarás en: <Text style={{ fontWeight: '800' }}>{serverLabel()}</Text>
      </Text>
      <Text onPress={() => router.push('/server')} style={{ color: colors.primary, fontWeight: '700', fontSize: 13, marginTop: 4 }}>
        Cambiar servidor
      </Text>
    </View>
  );
}

export const CONSENT_TITLE = 'Autorización de tratamiento de datos personales';

/** Texto del aviso de privacidad que el cliente acepta al registrarse (RQ14). Ley 1581 de 2012 (Colombia) */
export function ConsentText({ organization }: { organization?: string }) {
  const who = organization ? `las academias de ${organization}` : 'las academias en las que te registres';
  const p = { color: colors.text, fontSize: 14, lineHeight: 21, marginBottom: 8 } as const;
  return (
    <View>
      <Text style={p}>
        Autorizo de manera libre, previa, expresa e informada que mis datos personales (nombre, documento, contacto,
        planes adquiridos, pagos y registros de asistencia) sean tratados <Text style={{ fontWeight: '700' }}>única y exclusivamente por {who}</Text> y
        por sus funcionarios autorizados, con el fin de gestionar mi inscripción, mis planes, reservas, pagos, el
        control de ingreso mediante código QR y los reportes de asistencia.
      </Text>
      <Text style={p}>
        Mis datos no serán compartidos con otras academias, organizaciones ni terceros. Si me registro en una academia
        de otra organización, esa organización solo verá la información de ese registro.
      </Text>
      <Text style={p}>
        Como titular puedo conocer, actualizar, rectificar y solicitar la supresión de mis datos o revocar esta
        autorización solicitándolo al administrador de la academia, conforme a la Ley 1581 de 2012 y sus decretos
        reglamentarios.
      </Text>
    </View>
  );
}

/**
 * Selector de academia y sede. Con `allowAll` agrega la opcion "Todas" (valor null) para filtros de reportes.
 */
export function PlacePicker({ academyId, siteId, onChange, allowAll, requireSite }: {
  academyId: number | null; siteId: number | null; onChange: (academyId: number | null, siteId: number | null) => void;
  allowAll?: boolean; requireSite?: boolean;
}) {
  const academies = useLoad<Academy[]>('/academies');
  const sites = useLoad<Site[]>(academyId ? `/sites${qs({ academyId })}` : null);

  // Selecciona automaticamente cuando solo hay una opcion
  useEffect(() => {
    const list = academies.data?.filter((a) => a.active) ?? [];
    if (!academyId && !allowAll && list.length === 1) onChange(list[0].id, null);
  }, [academies.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const list = sites.data?.filter((s) => s.active) ?? [];
    if (academyId && !siteId && requireSite && list.length === 1) onChange(academyId, list[0].id);
  }, [sites.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = allowAll ? [{ value: null as number | null, label: 'Todas' }] : [];
  return (
    <View>
      <Chips<number | null>
        label="Academia"
        options={[...all, ...(academies.data ?? []).filter((a) => a.active).map((a) => ({ value: a.id as number | null, label: a.name }))]}
        value={academyId}
        onChange={(v) => onChange(v, null)}
      />
      {academyId ? (
        <Chips<number | null>
          label="Sede"
          options={[...all, ...(sites.data ?? []).filter((s) => s.active).map((s) => ({ value: s.id as number | null, label: s.name }))]}
          value={siteId}
          onChange={(v) => onChange(academyId, v)}
        />
      ) : null}
    </View>
  );
}
