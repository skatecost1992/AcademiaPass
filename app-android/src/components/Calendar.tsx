/**
 * Calendario mensual para elegir una fecha (RQ47). Solo permite fechas entre `min` y `max` ('YYYY-MM-DD').
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ymd } from '../lib/format';
import { colors } from './ui';

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const WEEK = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export function Calendar({ value, onChange, min, max, marked }: {
  value: string; onChange: (date: string) => void; min?: string; max?: string; marked?: string[];
}) {
  const initial = new Date(`${value || ymd(new Date())}T12:00:00`);
  const [month, setMonth] = useState({ y: initial.getFullYear(), m: initial.getMonth() });
  const first = new Date(month.y, month.m, 1);
  const offset = (first.getDay() + 6) % 7; // semana empieza en lunes
  const days = new Date(month.y, month.m + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => ymd(new Date(month.y, month.m, i + 1)))];
  while (cells.length % 7) cells.push(null);

  const canPrev = !min || ymd(new Date(month.y, month.m, 0)) >= min;
  const canNext = !max || ymd(new Date(month.y, month.m + 1, 1)) <= max;
  const move = (d: number) => setMonth(({ y, m }) => { const n = new Date(y, m + d, 1); return { y: n.getFullYear(), m: n.getMonth() }; });

  return (
    <View style={s.box}>
      <View style={s.head}>
        <Pressable onPress={() => canPrev && move(-1)} hitSlop={10} disabled={!canPrev} accessibilityLabel="Mes anterior">
          <Ionicons name="chevron-back" size={20} color={canPrev ? colors.primary : colors.border} />
        </Pressable>
        <Text style={s.title}>{MONTHS[month.m]} {month.y}</Text>
        <Pressable onPress={() => canNext && move(1)} hitSlop={10} disabled={!canNext} accessibilityLabel="Mes siguiente">
          <Ionicons name="chevron-forward" size={20} color={canNext ? colors.primary : colors.border} />
        </Pressable>
      </View>
      <View style={s.row}>{WEEK.map((w, i) => <Text key={i} style={s.week}>{w}</Text>)}</View>
      {Array.from({ length: cells.length / 7 }, (_, r) => (
        <View key={r} style={s.row}>
          {cells.slice(r * 7, r * 7 + 7).map((d, i) => {
            if (!d) return <View key={i} style={s.cell} />;
            const off = (min && d < min) || (max && d > max);
            const on = d === value;
            return (
              <Pressable key={d} disabled={!!off} onPress={() => onChange(d)} style={[s.cell, on && s.cellOn]} accessibilityLabel={d}>
                <Text style={[s.day, off && { color: colors.border }, on && { color: '#fff', fontWeight: '800' }]}>{Number(d.slice(8))}</Text>
                {marked?.includes(d) && !on ? <View style={s.dot} /> : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 10, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, paddingHorizontal: 4 },
  title: { fontSize: 15, fontWeight: '800', color: colors.text },
  row: { flexDirection: 'row' },
  week: { flex: 1, textAlign: 'center', color: colors.muted, fontSize: 12, fontWeight: '700', paddingVertical: 4 },
  cell: { flex: 1, aspectRatio: 1.15, alignItems: 'center', justifyContent: 'center', borderRadius: 8, margin: 1 },
  cellOn: { backgroundColor: colors.primary },
  day: { fontSize: 14, color: colors.text },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.accent, marginTop: 2 },
});
