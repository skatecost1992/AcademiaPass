import React from 'react';
import { type ClassesReport, ClassesReportView, RangePicker, UnifiedReportView, useRange } from '../components/ReportParts';
import { Loader, Muted, Screen, Section, useLoad } from '../components/ui';
import { qs } from '../lib/api';
import { addDays } from '../lib/format';
import type { UnifiedReport } from '../types';

/** Reporte del cliente: solo su informacion (RQ8, RQ15) */
export default function MyReport() {
  const range = useRange('month');
  const report = useLoad<UnifiedReport>(`/reports/me${qs({ from: range.from, to: range.to })}`);
  // RQ41: el cliente solo recibe sus propias clases
  const classes = useLoad<ClassesReport>(`/reports/classes${qs({ from: range.from, to: addDays(range.to, 30) })}`); // incluye las reservadas por venir
  return (
    <Screen title="Mi reporte" onRefresh={report.reload} refreshing={report.loading}>
      <Muted style={{ marginBottom: 10 }}>Tu asistencia en todas tus academias y el saldo de tus planes.</Muted>
      <RangePicker range={range} />
      <Loader state={report}>{(r) => <UnifiedReportView report={r} groupBy={range.groupBy} />}</Loader>
      <Section title="Mis clases reservadas y tomadas">
        <Loader state={classes}>{(c) => <ClassesReportView report={c} />}</Loader>
      </Section>
    </Screen>
  );
}
