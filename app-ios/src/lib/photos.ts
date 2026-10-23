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
/** RQ68: fotos que se pueden elegir de una vez en la galeria, y maximo por sede o espacio (igual que la API) */
export const MAX_PER_PICK = 15;
export const MAX_PER_OWNER = 30;

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
  return processAsset(result.assets[0]);
}

/** RQ68: elige varias fotos de la galeria a la vez (hasta `limit`, maximo 15) y las procesa */
export async function pickPhotos(limit = MAX_PER_PICK): Promise<ImagePicker.ImagePickerAsset[]> {
  const n = Math.max(1, Math.min(limit, MAX_PER_PICK));
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'], quality: 1, allowsEditing: false, exif: false, allowsMultipleSelection: n > 1, selectionLimit: n, orderedSelection: true,
  });
  if (result.canceled || !result.assets?.length) return [];
  return result.assets.slice(0, n);
}

/** Reduce y comprime una foto elegida o tomada */
export async function processAsset(asset: ImagePicker.ImagePickerAsset): Promise<PhotoPayload> {
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
