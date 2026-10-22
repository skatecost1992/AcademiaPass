import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { DAYS } from '../lib/format';
import type { OpeningSlot } from '../types';
import { Button, Muted, RowWrap, colors, styles } from './ui';

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // lunes a domingo

/** Horario de atencion: una franja por dia (RQ2). Sin dias marcados = la sede no restringe horarios */
export function OpeningHoursEditor({ value, onChange }: { value: OpeningSlot[]; onChange: (v: OpeningSlot[]) => void }) {
  const byDay = new Map(value.map((h) => [h.day, h]));
  const toggle = (day: number) => {
    if (byDay.has(day)) onChange(value.filter((h) => h.day !== day));
    else onChange([...value, { day, open: '06:00', close: '21:00' }].sort((a, b) => ORDER.indexOf(a.day) - ORDER.indexOf(b.day)));
  };
  const edit = (day: number, k: 'open' | 'close', v: string) => onChange(value.map((h) => (h.day === day ? { ...h, [k]: v } : h)));
  const copyMonday = () => {
    const m = byDay.get(1);
    if (m) onChange(value.map((h) => ({ ...h, open: m.open, close: m.close })));
  };

  return (
    <View>
      {ORDER.map((day) => {
        const h = byDay.get(day);
        return (
          <View key={day} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Pressable onPress={() => toggle(day)} style={[styles.chip, h && styles.chipOn, { width: 64, justifyContent: 'center' }]}>
              <Text style={[styles.chipText, h && { color: '#fff' }]}>{DAYS[day]}</Text>
            </Pressable>
            {h ? (
              <>
                <TextInput style={[styles.input, { flex: 1, paddingVertical: 7 }]} value={h.open} onChangeText={(v) => edit(day, 'open', v)} placeholder="06:00" />
                <Text style={{ color: colors.muted }}>a</Text>
                <TextInput style={[styles.input, { flex: 1, paddingVertical: 7 }]} value={h.close} onChangeText={(v) => edit(day, 'close', v)} placeholder="21:00" />
              </>
            ) : <Muted>Cerrado</Muted>}
          </View>
        );
      })}
      <RowWrap>
        {byDay.has(1) ? <Button small variant="ghost" label="Copiar horario del lunes a todos" onPress={copyMonday} /> : null}
      </RowWrap>
    </View>
  );
}
