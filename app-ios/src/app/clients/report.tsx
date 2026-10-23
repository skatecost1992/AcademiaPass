import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { RangePicker, UnifiedReportView, useRange } from '../../components/ReportParts';
import { H1, Loader, Muted, Screen, useLoad } from '../../components/ui';
import { qs } from '../../lib/api';
import type { UnifiedReport } from '../../types';

/** Reporte unificado de un cliente consultado por el administrador (RQ9, RQ15) */
export default function ClientReport() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const range = useRange('month');
  const report = useLoad<UnifiedReport>(`/reports/clients/${clientId}/unified${qs({ from: range.from, to: range.to })}`);
  return (
    <Screen title="Reporte unificado" onRefresh={report.reload} refreshing={report.loading}>
      {report.data ? <H1>{report.data.client.fullName}</H1> : null}
      <Muted style={{ marginBottom: 10 }}>Asistencia en todas las academias y saldo de cada plan.</Muted>
      <RangePicker range={range} />
      <Loader state={report}>{(r) => <UnifiedReportView report={r} groupBy={range.groupBy} />}</Loader>
    </Screen>
  );
}
