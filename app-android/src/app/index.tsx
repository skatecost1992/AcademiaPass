import { Redirect } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { Loading, colors } from '../components/ui';
import { useSession } from '../session';

/** Punto de entrada: decide entre ingreso, aceptacion de datos o inicio */
export default function Index() {
  const { ready, user } = useSession();
  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.bg }}>
        <Loading />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;
  if (user.consentRequired) return <Redirect href="/consent" />;
  return <Redirect href="/home" />;
}
