import 'package:image_picker/image_picker.dart';

/// One photo staged for a report, before it is uploaded.
///
/// Mirrors the columns `report_media` will need in the database
/// (see `docs/database.md`): `media_type`, `file_size`, `width`, `height`.
/// `storage_key` is assigned at upload time, and `checksum` is computed then
/// too — neither is known while the citizen is still filling out the form.
///
/// The underlying file lives in the app's cache directory, as written by
/// `image_picker`. Nothing is copied, so there is no cleanup to do when a
/// draft is discarded — see [ReportDraftProvider.clear].
class ReportPhoto {
  const ReportPhoto({
    required this.file,
    required this.name,
    required this.sizeBytes,
    required this.mimeType,
    required this.width,
    required this.height,
  });

  final XFile file;

  /// Original filename, or a generated one for camera captures.
  final String name;

  final int sizeBytes;

  /// Always an image type — the picker only accepts images.
  final String mimeType;

  final int width;
  final int height;

  /// Path on disk, used by `Image.file` for the thumbnail.
  String get path => file.path;

  /// Human-readable size, e.g. `1.4 MB`. Shown next to the thumbnail so the
  /// citizen can see what they're about to upload.
  String get formattedSize {
    const int kb = 1024;
    const int mb = kb * 1024;

    if (sizeBytes >= mb) {
      return '${(sizeBytes / mb).toStringAsFixed(1)} MB';
    }
    if (sizeBytes >= kb) {
      return '${(sizeBytes / kb).toStringAsFixed(0)} KB';
    }
    return '$sizeBytes B';
  }
}
