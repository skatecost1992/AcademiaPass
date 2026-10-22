import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { BookingForm } from '../../components/BookingForm';
import { Screen } from '../../components/ui';

export default function NewBooking() {
  const { kind } = useLocalSearchParams<{ kind?: 'class' | 'rental' }>();
  return (
    <Screen title={kind === 'rental' ? 'Reservar espacio' : 'Programar clase'}>
      <BookingForm mode="staff" initialKind={kind === 'rental' ? 'rental' : 'class'} />
    </Screen>
  );
}
