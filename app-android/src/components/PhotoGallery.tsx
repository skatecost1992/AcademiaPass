/**
 * Galeria de fotos de una sede o un espacio (RQ29). La lista trae solo metadatos; cada imagen en Base64 se
 * descarga al mostrarse y queda en una cache en memoria mientras la app este abierta.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { del, get, post, qs } from '../lib/api';
import { MAX_PER_OWNER, MAX_PER_PICK, dataUri, pickPhoto, pickPhotos, processAsset } from '../lib/photos';
import { Button, Muted, RowWrap, colors, confirm, errorText, notify, useLoad } from './ui';

interface PhotoMeta { id: number; mime: string; width: number | null; height: number | null; size_bytes: number }

const cache = new Map<number, string>();

function Thumb({ photo, onOpen }: { photo: PhotoMeta; onOpen: (uri: string) => void }) {
  const [uri, setUri] = useState(cache.get(photo.id) ?? null);
  useEffect(() => {
    if (uri) return;
    let alive = true;
    get<{ mime: string; data: string }>(`/photos/${photo.id}`)
      .then((p) => {
        const u = dataUri(p.mime, p.data);
        cache.set(photo.id, u);
        if (alive) setUri(u);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [photo.id, uri]);
  return (
    <Pressable onPress={() => uri && onOpen(uri)} style={s.thumb}>
      {uri ? <Image source={{ uri }} style={s.thumbImg} resizeMode="cover" /> : <ActivityIndicator color={colors.primary} />}
    </Pressable>
  );
}

export function PhotoGallery({ ownerType, ownerId, editable }: { ownerType: 'site' | 'space'; ownerId: number | null; editable: boolean }) {
  const list = useLoad<PhotoMeta[]>(ownerId ? `/photos${qs({ ownerType, ownerId })}` : null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [open, setOpen] = useState<{ uri: string; id: number } | null>(null);

  if (!ownerId) return <Muted>Guarda primero para poder agregar fotos.</Muted>;

  const upload = async (photo: Awaited<ReturnType<typeof processAsset>>) => {
    const saved = await post<PhotoMeta>('/photos', { ownerType, ownerId, ...photo });
    cache.set(saved.id, dataUri(photo.mime, photo.data));
  };

  const takePhoto = async () => {
    try {
      const photo = await pickPhoto('camera');
      if (!photo) return;
      setBusy(true);
      await upload(photo);
      await list.reload();
    } catch (e) {
      notify('No se pudo cargar la foto', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // RQ68: hasta 15 fotos de la galeria a la vez; se suben una por una mostrando el avance
  const fromLibrary = async () => {
    const room = MAX_PER_OWNER - (list.data?.length ?? 0);
    if (room <= 0) return notify('Límite de fotos', `Ya tiene ${MAX_PER_OWNER} fotos. Elimina alguna para agregar más.`);
    let done = 0;
    const failed: string[] = [];
    try {
      const assets = await pickPhotos(Math.min(MAX_PER_PICK, room));
      if (!assets.length) return;
      setBusy(true);
      for (const [i, asset] of assets.entries()) {
        setProgress(`Subiendo ${i + 1} de ${assets.length}…`);
        try {
          await upload(await processAsset(asset));
          done++;
        } catch (e) {
          failed.push(`Foto ${i + 1}: ${errorText(e)}`);
        }
      }
      await list.reload();
      if (failed.length) notify(`Se cargaron ${done} de ${assets.length} fotos`, failed.slice(0, 3).join('\n'));
    } catch (e) {
      notify('No se pudieron cargar las fotos', errorText(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const remove = async (photoId: number) => {
    if (!(await confirm('Eliminar foto', '¿Quieres eliminar esta foto?', 'Eliminar'))) return;
    try {
      await del(`/photos/${photoId}`);
      cache.delete(photoId);
      setOpen(null);
      await list.reload();
    } catch (e) {
      notify('No se pudo eliminar', errorText(e));
    }
  };

  const photos = list.data ?? [];
  const totalKb = Math.round(photos.reduce((a, p) => a + p.size_bytes, 0) / 1024);
  return (
    <View>
      {photos.length === 0 && !list.loading ? <Muted>Sin fotos todavía.</Muted> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
        {photos.map((p) => (
          <Thumb key={p.id} photo={p} onOpen={(uri) => setOpen({ uri, id: p.id })} />
        ))}
      </ScrollView>
      {photos.length ? <Muted style={{ fontSize: 12 }}>{photos.length} de {MAX_PER_OWNER} foto(s) · {totalKb} KB en total</Muted> : null}
      {progress ? <Muted style={{ fontSize: 12, color: colors.primary }}>{progress}</Muted> : null}
      {editable ? (
        <RowWrap style={{ marginTop: 8 }}>
          <Button small icon="camera-outline" label="Tomar foto" variant="secondary" onPress={takePhoto} loading={busy && !progress} disabled={busy} />
          <Button small icon="images-outline" label={`Galería (hasta ${MAX_PER_PICK})`} variant="secondary" onPress={fromLibrary} loading={!!progress} disabled={busy} />
        </RowWrap>
      ) : null}
      <Modal visible={!!open} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <View style={s.viewer}>
          {open ? <Image source={{ uri: open.uri }} style={{ width: '100%', height: '75%' }} resizeMode="contain" /> : null}
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
            {editable && open ? <Button label="Eliminar" variant="danger" icon="trash-outline" onPress={() => remove(open.id)} /> : null}
            <Button label="Cerrar" onPress={() => setOpen(null)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  thumb: { width: 110, height: 82, borderRadius: 10, backgroundColor: '#E5ECEA', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbImg: { width: '100%', height: '100%' },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: 16 },
});

export function PhotoIcon({ count }: { count: number }) {
  if (!count) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <Ionicons name="image-outline" size={14} color={colors.muted} />
      <Text style={{ color: colors.muted, fontSize: 12 }}>{count}</Text>
    </View>
  );
}
