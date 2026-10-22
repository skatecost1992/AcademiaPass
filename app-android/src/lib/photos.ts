/**
 * Fotos de sedes y espacios (RQ29): se toman con la camara o se eligen de la galeria, se reducen a un maximo de
 * 1600 px por lado y se comprimen en JPEG de buena calidad (0.8) antes de enviarlas en Base64. Asi una foto
 * ocupa ~200-500 KB en la base de datos en vez de los 3-8 MB del original.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

export const MAX_SIDE = 1600;
export const QUALITY = 0.8;

export interface PhotoPayload {
  mime: 'image/jpeg';
  data: string; // Base64 sin encabezado data:
  width: number;
  height: number;
}

export async function pickPhoto(source: 'camera' | 'library'): Promise<PhotoPayload | null> {
  if (source === 'camera' && Platform.OS !== 'web') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Sin permiso para usar la cámara. Actívalo en los ajustes del teléfono.');
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: false, exif: false };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];

  // Solo se reduce si supera el maximo: nunca se agranda
  const ctx = ImageManipulator.manipulate(asset.uri);
  if (asset.width && asset.height && Math.max(asset.width, asset.height) > MAX_SIDE) {
    ctx.resize(asset.width >= asset.height ? { width: MAX_SIDE } : { height: MAX_SIDE });
  }
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: QUALITY, base64: true });
  if (!out.base64) throw new Error('No se pudo procesar la foto');
  return { mime: 'image/jpeg', data: out.base64.replace(/^data:image\/\w+;base64,/, ''), width: out.width, height: out.height };
}

export const dataUri = (mime: string, data: string) => `data:${mime};base64,${data}`;
