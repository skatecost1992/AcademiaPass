import { router } from 'expo-router';
import React from 'react';
import { Badge, Button, ListItem, Loader, Muted, Screen, Section, useLoad } from '../../components/ui';
import type { Permission } from '../../types';

export interface StaffUser { id: number; username: string; full_name: string; email: string | null; phone: string | null; role: 'admin' | 'staff'; permissions: Permission[]; active: boolean; document: string }

/** Usuarios del personal con permisos (RQ17) */
export default function Users() {
  const list = useLoad<StaffUser[]>('/users');
  return (
    <Screen title="Usuarios" onRefresh={list.reload} refreshing={list.loading}>
      <Muted>Crea usuarios para tu personal y dales solo los permisos que necesitan: registrar asistencias, configurar horarios, clases, reservas, etc.</Muted>
      <Button label="Nuevo usuario" icon="person-add-outline" onPress={() => router.push('/users/edit')} style={{ marginTop: 12 }} />
      <Section title="Personal">
        <Loader state={list}>
          {(rows) => rows.map((u) => (
            <ListItem
              key={u.id}
              icon={u.role === 'admin' ? 'shield-checkmark-outline' : 'person-outline'}
              title={u.full_name}
              muted={!u.active}
              subtitle={`${u.username} · ${u.role === 'admin' ? 'Todos los permisos' : `${u.permissions.length} permiso(s)`}`}
              right={<Badge text={u.role === 'admin' ? 'Admin' : u.active ? 'Personal' : 'Inactivo'} tone={u.role === 'admin' ? 'primary' : u.active ? 'success' : 'muted'} />}
              onPress={u.role === 'staff' ? () => router.push({ pathname: '/users/edit', params: { id: String(u.id) } }) : undefined}
            />
          ))}
        </Loader>
      </Section>
    </Screen>
  );
}
