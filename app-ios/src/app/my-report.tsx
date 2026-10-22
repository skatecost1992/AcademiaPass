import React from 'react';
import { RangePicker, UnifiedReportView, useRange } from '../components/ReportParts';
import { Loader, Muted, Screen, useLoad } from '../components/ui';
import { qs } from '../lib/api';
import type { UnifiedReport } from '../types';

/** Reporte del cliente: solo su informacion (RQ8, RQ15) */
export default function MyReport() {
  const range = useRange(90);
  const report = useLoad<UnifiedReport>(`/reports/me${qs({ from: range.from, to: range.to })}`);
  return (
    <Screen title="Mi reporte" onRefresh={report.reload} refreshing={report.loading}>
      <Muted style={{ marginBottom: 10 }}>Tu asistencia en todas tus academias y el saldo de tus planes.</Muted>
      <RangePicker range={range} />
      <Loader state={report}>{(r) => <UnifiedReportView report={r} groupBy={range.groupBy} />}</Loader>
    </Screen>
  );
}
