import React from 'react';
import { BookingForm } from '../../components/BookingForm';
import { Screen } from '../../components/ui';

export default function NewMyBooking() {
  return (
    <Screen title="Reservar espacio">
      <BookingForm mode="client" />
    </Screen>
  );
}
