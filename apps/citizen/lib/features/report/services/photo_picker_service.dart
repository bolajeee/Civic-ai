import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../../core/constants/app_constants.dart';
import '../models/report_photo.dart';

/// Thrown when the citizen cannot use the camera because access was refused.
///
/// Distinct from a generic failure so the UI can offer "Open Settings" only
/// when that is actually the remedy. [permanentlyDenied] means the OS will no
/// longer show a prompt — the only way forward is the Settings app.
class PhotoPermissionException implements Exception {
  const PhotoPermissionException({required this.permanentlyDenied});

  final bool permanentlyDenied;

  @override
  String toString() => 'PhotoPermissionException(permanentlyDenied: '
      '$permanentlyDenied)';
}

/// Captures photos for a report, from the camera or the photo library.
///
/// Every image is downsampled to [AppConstants.reportPhotoMaxDimension] and
/// re-encoded at [AppConstants.reportPhotoQuality]. A 12MP phone capture is
/// several megabytes; capping it here means the citizen is not waiting on a
/// slow mobile connection later, and the staged draft stays small.
class PhotoPickerService {
  PhotoPickerService._();
  static final PhotoPickerService instance = PhotoPickerService._();

  final ImagePicker _picker = ImagePicker();

  /// Opens the OS camera. Returns null if the citizen backs out without
  /// capturing — that is a normal outcome, not an error.
  ///
  /// Throws [PhotoPermissionException] if camera access is refused.
  Future<ReportPhoto?> pickFromCamera() async {
    await _ensureCameraPermission();
    return _pick(ImageSource.camera);
  }

  /// Opens the system photo library.
  ///
  /// No permission gate: Android 13+ uses the system photo picker and iOS 14+
  /// uses `PHPickerViewController`, both of which grant access to only the
  /// images the citizen selects and need no runtime permission.
  Future<ReportPhoto?> pickFromGallery() => _pick(ImageSource.gallery);

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /// Checks camera access, requesting it once if it has never been asked for.
  ///
  /// Pre-checking is what turns a refusal into an explicable error. Without it
  /// `image_picker` fails in a way we cannot distinguish from a cancelled
  /// capture, and the citizen sees nothing happen.
  Future<void> _ensureCameraPermission() async {
    final status = await Permission.camera.status;

    if (status.isGranted) return;

    // The OS will not show a prompt again — asking is a no-op, so go straight
    // to telling the citizen to open Settings.
    if (status.isPermanentlyDenied) {
      throw const PhotoPermissionException(permanentlyDenied: true);
    }

    final requested = await Permission.camera.request();
    if (requested.isGranted) return;

    throw PhotoPermissionException(
      permanentlyDenied: requested.isPermanentlyDenied,
    );
  }

  Future<ReportPhoto?> _pick(ImageSource source) async {
    final picked = await _picker.pickImage(
      source: source,
      maxWidth: AppConstants.reportPhotoMaxDimension,
      maxHeight: AppConstants.reportPhotoMaxDimension,
      imageQuality: AppConstants.reportPhotoQuality,
    );

    if (picked == null) return null;

    final bytes = await picked.readAsBytes();
    final dimensions = await _readDimensions(bytes);

    return ReportPhoto(
      file: picked,
      name: picked.name,
      sizeBytes: bytes.length,
      mimeType: _mimeTypeFor(picked.name),
      width: dimensions.$1,
      height: dimensions.$2,
    );
  }

  /// Decodes just far enough to learn the pixel dimensions.
  ///
  /// `report_media` records `width` and `height`, so they are captured now
  /// rather than re-decoding every image at upload time. The image is already
  /// downsampled by this point, so this is cheap.
  Future<(int, int)> _readDimensions(Uint8List bytes) async {
    final buffer = await ui.ImmutableBuffer.fromUint8List(bytes);

    ui.ImageDescriptor? descriptor;
    ui.Codec? codec;
    ui.Image? image;

    try {
      descriptor = await ui.ImageDescriptor.encoded(buffer);
      codec = await descriptor.instantiateCodec();
      final frame = await codec.getNextFrame();
      image = frame.image;
      return (image.width, image.height);
    } catch (_) {
      // An unreadable header must not lose the photo — report 0x0 and let the
      // upload path deal with it.
      return (0, 0);
    } finally {
      image?.dispose();
      codec?.dispose();
      descriptor?.dispose();
      buffer.dispose();
    }
  }

  /// `image_picker` re-encodes camera captures to JPEG, but gallery picks keep
  /// their original container, so the extension is the reliable signal.
  String _mimeTypeFor(String fileName) {
    final dot = fileName.lastIndexOf('.');
    if (dot == -1) return 'image/jpeg';

    switch (fileName.substring(dot + 1).toLowerCase()) {
      case 'png':
        return 'image/png';
      case 'heic':
        return 'image/heic';
      case 'heif':
        return 'image/heif';
      case 'webp':
        return 'image/webp';
      case 'gif':
        return 'image/gif';
      default:
        return 'image/jpeg';
    }
  }
}
