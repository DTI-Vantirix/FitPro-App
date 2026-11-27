/** Choosing the photo or video of a post. Used by the composer (app/share-run.tsx) only.
 *
 * - "Choose from library" opens the system picker (PHPicker on iOS, the Android photo
 *   picker). Both run outside the app and hand back just the one item the runner picks, so
 *   no photo-library permission is asked for, at any time.
 * - "Take a photo" asks for the camera when it is tapped, never earlier. Photos only: no
 *   video is recorded, so the microphone is never used.
 * - Nothing leaves the phone here. The picked file sits in the app's cache until the runner
 *   taps Post (or is simply never sent).
 *
 * Location and other details saved inside a file: expo-image-picker has no option to strip
 * them. `exif: false` keeps them out of what the picker hands to JavaScript, and nothing
 * here reads them, but the file itself can still carry them (see docs/native-contract.md).
 */
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { checkMedia, type PickedMedia } from './media';
import { fileSize } from './upload-file';

export type PickResult =
  | { status: 'picked'; media: PickedMedia }
  | { status: 'cancelled' }
  | { status: 'refused'; error: string };

/** Android 8 and 9 hand a camera photo back only through shared storage, which this app
 * blocks itself from (WRITE_EXTERNAL_STORAGE). There the library is the way in. */
export const canTakePhoto = Platform.OS !== 'android' || Number(Platform.Version) >= 29;

const COMMON: ImagePicker.ImagePickerOptions = {
  allowsEditing: false,
  allowsMultipleSelection: false,
  exif: false,
  base64: false,
  // iOS re-encodes a JPEG below full quality, which also drops what was saved inside it.
  // Android would re-encode a GIF or WebP as a JPEG under its old name, so it copies as is.
  quality: Platform.OS === 'ios' ? 0.85 : 1,
};

function settle(result: ImagePicker.ImagePickerResult): PickResult {
  const asset = result.canceled ? null : result.assets?.[0];
  if (!asset) return { status: 'cancelled' };
  const checked = checkMedia({ uri: asset.uri, mimeType: asset.mimeType, fileName: asset.fileName, fileSize: asset.fileSize ?? fileSize(asset.uri) });
  return checked.ok ? { status: 'picked', media: checked.media } : { status: 'refused', error: checked.error };
}

const failed = (what: string): PickResult => ({ status: 'refused', error: `${what} Try again, or pick a different one.` });

export async function chooseFromLibrary(): Promise<PickResult> {
  try {
    return settle(await ImagePicker.launchImageLibraryAsync({
      ...COMMON,
      mediaTypes: ['images', 'videos'],
      // Ask iOS for the widely readable form (JPEG, H.264) so the post shows on every phone and on the website.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    }));
  } catch {
    return failed('That photo or video could not be read.');
  }
}

export async function takePhoto(): Promise<PickResult> {
  if (!canTakePhoto) return { status: 'refused', error: 'Taking a photo here needs a newer version of Android. Take it with your camera app, then choose it from your library.' };
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      return { status: 'refused', error: permission.canAskAgain
        ? 'VantraRun needs the camera to take a photo. You can choose one from your library instead.'
        : 'The camera is turned off for VantraRun. Turn it on in your phone\'s Settings, or choose a photo from your library instead.' };
    }
    return settle(await ImagePicker.launchCameraAsync({ ...COMMON, mediaTypes: ['images'] }));
  } catch {
    return failed('The camera could not take that photo.');
  }
}
